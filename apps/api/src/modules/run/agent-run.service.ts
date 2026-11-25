import { createHash, randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  HttpException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import {
  AgentStateEntity,
  ConversationEntity,
  KnowledgeFileEntity,
  MessageEntity,
  ProjectEntity,
  RunEntity,
} from "@arch-flow/db";
import { AgentExecutionError, GRAPH_REFERENCE_QUESTION, type createAgentEngine } from "@arch-flow/agent";
import {
  ActiveRun,
  AGENT_HISTORY_LIMIT,
  AgentTurn,
  AgentTurnResult,
  AnswerCardInput,
  DraftLayout,
  ERROR_CODES,
  GraphInput,
  IdempotencyKey,
  Interrupt,
  MessageMetadata,
  RunAccepted,
  SendMessageInput,
  runStreamUrl,
  type AgentResume,
  type CardAnswer,
  type ConstraintCard,
  type Run as RunResult,
} from "@arch-flow/shared";
import { type EntityManager, In } from "typeorm";
import { DatabaseService } from "../../database/database.service.js";
import { RESULT_FRAME_LIMIT, RunEvents } from "./run-events.js";
import {
  RUN_ACTIVE_STATUSES,
  RunMetadata,
  getOwnedConversation,
  getRunMessages,
  resourceId,
  runException,
  snapshotRun,
  type RunSnapshot,
} from "./run-store.js";

export const RUN_ENGINE = Symbol("RUN_ENGINE");
export type RunEngine = ReturnType<typeof createAgentEngine>;

const RUN_TIMEOUT_MS = 90_000;
const LEASE_TIMEOUT_MS = RUN_TIMEOUT_MS + 30_000;
const INTERRUPT_TIMEOUT_MS = 24 * 60 * 60_000;
const EXTRAS_TIMEOUT_MS = 25_000;
const PARTIAL_SAVE_INTERVAL_MS = 250;
const DEFAULT_TITLE = "新会话";

const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hasExpired = (expiresAt?: string) =>
  !!expiresAt && Date.parse(expiresAt) <= Date.now();
const notResumable = () =>
  runException(
    409,
    ERROR_CODES.RUN_NOT_RESUMABLE,
    "运行正在执行或已结束，无法继续这个中断",
  );

type ClaimedRun = {
  turn: AgentTurn;
  resume?: AgentResume;
  token: string;
  stateVersion: number;
  snapshot: RunSnapshot;
};

export const acceptedRun = ({ id, userMessageId, assistantMessageId, status }: RunResult) =>
  RunAccepted.parse({ runId: id, userMessageId, assistantMessageId, status, streamUrl: runStreamUrl(id) });

const clarificationOptions = (checkpoint: AgentTurnResult & { status: "waiting_input" }) => {
  if (checkpoint.checkpoint.question === GRAPH_REFERENCE_QUESTION) return [];
  const conflict = checkpoint.checkpoint.conflictKey;
  const decision = checkpoint.checkpoint.decision;
  if (conflict) {
    const values = [checkpoint.constraints[conflict], decision.constraintUpdates[conflict]];
    return [...new Set(values.filter((value) => value !== undefined))].map((value) => ({ value, label: value }));
  }
  if (decision.intents.includes("generate_graph") && !checkpoint.constraints.projectGoal) {
    return ["在线订单系统", "商品库存系统", "预约管理系统"].map((value) => ({ value, label: value }));
  }
  return [];
};

@Injectable()
export class AgentRunService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgentRunService.name);
  private readonly running = new Map<string, AbortController>();
  private readonly dispatched = new Map<string, Promise<void>>();
  private closing = false;
  readonly events = new RunEvents();

  constructor(
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, "dataSource">,
    @Inject(RUN_ENGINE) private readonly engine: RunEngine | null,
  ) {}

  accept = async (
    ownerId: string,
    conversationId: string,
    body: SendMessageInput,
    idempotencyKey: string,
    traceId: string = randomUUID(),
  ): Promise<RunResult> => {
    const input = SendMessageInput.parse(body);
    const key = IdempotencyKey.parse(idempotencyKey);
    const scopedOwner = resourceId(ownerId);
    const scope = { conversationId: resourceId(conversationId) };
    const attachments = [...new Set((input.attachments ?? []).map(resourceId))];
    const graphReferenceMessageId = input.graphReferenceMessageId && resourceId(input.graphReferenceMessageId);
    const hash = digest({ content: input.content, attachments, graphReferenceMessageId });

    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(
        manager,
        scopedOwner,
        scope,
      );
      const runs = manager.getRepository(RunEntity);
      const replay = await this.replay(manager, conversation, key, hash);

      if (replay) {
        return (await snapshotRun(manager, replay, conversation)).run;
      }

      this.requireEngine();
      if (graphReferenceMessageId)
        await this.referencedGraph(manager, conversation.id, graphReferenceMessageId);
      const active = await runs.findOneBy({
        conversationId: conversation.id,
        status: In(RUN_ACTIVE_STATUSES),
      });
      if (active && !(await this.expire(manager, active))) {
        const metadata = RunMetadata.parse(active.metadata ?? {});
        if (
          active.status !== "waiting_input" ||
          !metadata.interrupt ||
          attachments.length > 0
        ) {
          throw runException(
            409,
            ERROR_CODES.CONVERSATION_BUSY,
            "会话已有运行中的任务，请等待它完成",
          );
        }
        metadata.receipts.push({ key, hash });
        if (graphReferenceMessageId) metadata.graphReferenceMessageId = graphReferenceMessageId;
        await this.resumeLocked(
          manager,
          conversation,
          active,
          metadata,
          metadata.interrupt.interruptId,
          input.content,
        );
        return (await snapshotRun(manager, active, conversation)).run;
      }

      if (attachments.length !== 0) {
        const count = await manager.countBy(KnowledgeFileEntity, {
          projectId: conversation.projectId,
          uuid: In(attachments),
        });
        if (count !== attachments.length)
          throw runException(
            404,
            ERROR_CODES.FILE_NOT_FOUND,
            "附件不属于当前项目或已删除",
          );
      }

      const messages = manager.getRepository(MessageEntity);
      const user = await messages.save({
        conversationId: conversation.id,
        role: "user",
        content: input.content,
        draftGraphContext: { graph: conversation.currentDraftGraph },
      });
      const assistant = await messages.save({
        conversationId: conversation.id,
        role: "assistant",
        content: "",
        draftGraphContext: { graph: conversation.currentDraftGraph },
      });
      const run = await runs.save({
        conversationId: conversation.id,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
        status: "queued",
        metadata: RunMetadata.parse({ attachments, graphReferenceMessageId, receipts: [{ key, hash }], traceId }),
      });
      await manager.update(ConversationEntity, conversation.id, {
        updatedAt: new Date(),
      });
      return (await snapshotRun(manager, run, conversation)).run;
    });
  };

  answerCard = async (
    ownerId: string,
    conversationId: string,
    messageId: string,
    body: AnswerCardInput,
    key: string,
  ): Promise<RunResult> => {
    const input = AnswerCardInput.parse(body);
    const messageUuid = resourceId(messageId);
    const hash = digest({ messageUuid, input });
    const result = await this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(manager, resourceId(ownerId), { conversationId: resourceId(conversationId) });
      const replay = await this.replay(manager, conversation, IdempotencyKey.parse(key), hash);
      if (replay) return (await snapshotRun(manager, replay, conversation)).run;

      const assistant = await manager.findOneBy(MessageEntity, { uuid: messageUuid, conversationId: conversation.id, role: "assistant" });
      const card = MessageMetadata.parse(assistant?.metadata ?? {}).card;
      const run = assistant && await manager.findOneBy(RunEntity, { assistantMessageId: assistant.id, conversationId: conversation.id });
      if (!card || !run || (input.cardId !== undefined && input.cardId !== card.id))
        throw runException(404, ERROR_CODES.CARD_NOT_FOUND, "追问卡片不存在");
      const metadata = RunMetadata.parse(run.metadata);
      if (await this.expire(manager, run) || card.status === "expired") return null;
      if (card.status !== "pending") {
        if (card.status === "answered" && digest(card.answer) === digest({ values: input.values, isCustom: input.isCustom }))
          return (await snapshotRun(manager, run, conversation)).run;
        throw notResumable();
      }

      const answer = this.cardAnswer(card, input);
      this.requireEngine();
      metadata.receipts.push({ key, hash });
      await this.resumeLocked(manager, conversation, run, metadata, card.id, answer, { values: input.values, isCustom: input.isCustom });
      return (await snapshotRun(manager, run, conversation)).run;
    });
    if (!result) throw runException(409, ERROR_CODES.CARD_EXPIRED, "这张追问卡片已过期，请重新发送请求");
    return result;
  };

  private cardAnswer = (card: ConstraintCard, input: AnswerCardInput) => {
    const { values, isCustom } = input;
    const possible = new Map(card.options.map(({ value, label }) => [value, label]));
    if (
      new Set(values).size !== values.length ||
      ((card.kind !== "multi" || isCustom) && values.length !== 1) ||
      (!isCustom && card.kind !== "text" && values.some((value) => !possible.has(value)))
    ) throw runException(422, ERROR_CODES.VALIDATION_FAILED, "请选择卡片提供的回答选项");
    const answer = AgentTurn.shape.input.safeParse(values.map((value) => isCustom ? value : possible.get(value) ?? value).join("、"));
    if (!answer.success) throw runException(422, ERROR_CODES.VALIDATION_FAILED, "回答太长，请缩短后重试");
    return answer.data;
  };

  private replay = async (manager: EntityManager, conversation: ConversationEntity, key: string, hash: string) => {
    const existing = await manager.getRepository(RunEntity).createQueryBuilder("run")
      .where("run.conversation_id = :conversationId", { conversationId: conversation.id })
      .andWhere("(run.metadata -> 'receipts') @> CAST(:receipt AS jsonb)", { receipt: JSON.stringify([{ key }]) })
      .getOne();
    if (existing) {
      if (RunMetadata.parse(existing.metadata).receipts.find((receipt) => receipt.key === key)?.hash !== hash)
        throw runException(409, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, "该请求键已用于其他消息");
      await this.expire(manager, existing);
    }
    return existing;
  };

  private referencedGraph = async (manager: EntityManager, conversationId: string, messageId: string) => {
    const message = await manager.findOneBy(MessageEntity, { uuid: messageId, conversationId, role: "assistant" });
    const graph = GraphInput.safeParse(message?.graphSnapshot);
    if (!graph.success)
      throw runException(404, ERROR_CODES.MESSAGE_NOT_FOUND, "找不到这张历史架构图，请从当前会话重新选择");
    return { messageId, graph: graph.data };
  };

  resume = async (
    ownerId: string,
    runId: string,
    interruptId: string,
    rawAnswer: string,
  ): Promise<RunResult> => {
    const answer = AgentTurn.shape.input.parse(rawAnswer);
    const scope = { runId: resourceId(runId) };
    const scopedOwner = resourceId(ownerId);
    const id = resourceId(interruptId);

    const result = await this.database.dataSource.transaction(
      async (manager) => {
        const conversation = await getOwnedConversation(
          manager,
          scopedOwner,
          scope,
        );
        const run = await manager.findOneByOrFail(RunEntity, {
          uuid: scope.runId,
          conversationId: conversation.id,
        });
        const metadata = RunMetadata.parse(run.metadata ?? {});
        if (metadata.usedInterrupts[id]) {
          if (metadata.usedInterrupts[id] !== digest(answer)) {
            throw runException(
              409,
              ERROR_CODES.IDEMPOTENCY_KEY_REUSED,
              "该澄清已提交过其他回答",
            );
          }
          await this.expire(manager, run);
          return (await snapshotRun(manager, run, conversation)).run;
        }
        if (await this.expire(manager, run)) return null;
        this.requireEngine();
        await this.resumeLocked(
          manager,
          conversation,
          run,
          metadata,
          id,
          answer,
        );
        return (await snapshotRun(manager, run, conversation)).run;
      },
    );
    if (!result) throw notResumable();
    return result;
  };

  private resumeLocked = async (
    manager: EntityManager,
    conversation: ConversationEntity,
    run: RunEntity,
    metadata: RunMetadata,
    interruptId: string,
    answer: string,
    cardAnswer: CardAnswer = { values: [answer], isCustom: true },
  ) => {
    if (
      run.status !== "waiting_input" ||
      metadata.interrupt?.interruptId !== interruptId ||
      !metadata.checkpoint
    ) {
      throw notResumable();
    }

    const response = await manager.save(MessageEntity, {
      conversationId: conversation.id,
      role: "user",
      content: answer,
      draftGraphContext: { graph: conversation.currentDraftGraph },
    });
    const { assistant } = await getRunMessages(manager, run);
    const messageMetadata = MessageMetadata.parse(assistant.metadata ?? {});
    if (messageMetadata.card) {
      messageMetadata.card.status = "answered";
      messageMetadata.card.answer = cardAnswer;
      messageMetadata.card.answeredAt = new Date().toISOString();
      await manager.update(MessageEntity, assistant.id, {
        metadata: messageMetadata,
      });
    }

    metadata.usedInterrupts[interruptId] = digest(answer);
    metadata.response = { messageId: response.id, answer };
    delete metadata.interrupt;
    run.status = "queued";
    run.metadata = metadata;
    await manager.save(RunEntity, run);
    await manager.update(ConversationEntity, conversation.id, {
      updatedAt: new Date(),
    });
  };

  /** Called after the acceptance transaction has committed, independently of any subscriber. */
  execute = async (ownerId: string, runId: string): Promise<void> => {
    const engine = this.requireEngine();
    const scope = { runId: resourceId(runId) };
    const scopedOwner = resourceId(ownerId);
    const claim = await this.claim(scopedOwner, scope);
    if (!claim) {
      await this.publishResult(scopedOwner, scope.runId);
      return;
    }

    const controller = new AbortController();
    this.running.set(scope.runId, controller);
    const deadlineAt = Date.now() + RUN_TIMEOUT_MS;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(RUN_TIMEOUT_MS),
    ]);
    const { assistantMessageId } = claim.snapshot.run;
    const traceId = claim.snapshot.traceId ?? randomUUID();
    let lastSavedAt = 0;
    let persistedText = "";
    let receivedText: string | undefined;

    const flushPartial = async () => {
      const text = receivedText;
      if (text === undefined || (lastSavedAt !== 0 && text === persistedText)) return;
      const saved = await this.database.dataSource.transaction(async (manager) => {
        const conversation = await getOwnedConversation(manager, scopedOwner, scope);
        const run = await manager.findOneByOrFail(RunEntity, { uuid: scope.runId, conversationId: conversation.id });
        if (!this.ownsClaim(run, claim)) return false;
        await manager.update(MessageEntity, { id: run.assistantMessageId, conversationId: conversation.id }, { content: text });
        return true;
      });
      if (!saved || controller.signal.aborted) return;
      const replace = (!lastSavedAt && Boolean(claim.resume)) || !text.startsWith(persistedText);
      this.events.publish(runId, {
        type: "text-delta",
        messageId: assistantMessageId,
        content: replace ? text : text.slice(persistedText.length),
        ...(replace ? { replace: true } : {}),
      });
      persistedText = text;
      lastSavedAt = Date.now();
    };

    try {
      this.events.begin(claim.snapshot, traceId, claim.resume ? true : undefined);
      const result = AgentTurnResult.parse(
        await engine.execute(claim.turn, {
          resume: claim.resume,
          signal,
          deadlineAt,
          onStage: (stage) => this.events.publish(runId, { type: "status", stage }),
          onTextDelta: async (delta, replace) => {
            receivedText = replace ? delta : (receivedText ?? "") + delta;
            if (replace || Date.now() - lastSavedAt >= PARTIAL_SAVE_INTERVAL_MS) await flushPartial();
          },
        }),
      );
      signal.throwIfAborted();
      const completion = await this.commit(scopedOwner, scope, claim, result);
      if (completion && result.status === "succeeded") {
        const finishExtras = async () => {
          try {
            await this.persistExtras(engine, claim, result.text, completion);
          } catch {
            this.logger.warn(`生成会话辅助内容失败 runId=${scope.runId}`);
          }
        };
        void finishExtras();
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        try {
          await flushPartial();
        } catch {
          this.logger.warn(`保存回答片段失败 runId=${scope.runId}`);
        }
      }
      const code =
        error instanceof AgentExecutionError
          ? error.code
          : signal.aborted && !controller.signal.aborted
            ? ERROR_CODES.AGENT_TASK_TIMEOUT
            : ERROR_CODES.SERVICE_UNAVAILABLE;
      const message =
        error instanceof AgentExecutionError
          ? error.message
          : code === ERROR_CODES.AGENT_TASK_TIMEOUT
            ? "当前请求处理超时，请重试"
            : "当前任务未完成，请重试";
      const detached =
        error instanceof HttpException && error.getStatus() === 404;
      if (!detached) {
        await this.database.dataSource.transaction(async (manager) => {
          await getOwnedConversation(manager, scopedOwner, scope);
          const run = await manager.findOneByOrFail(RunEntity, {
            uuid: scope.runId,
          });
          if (this.ownsClaim(run, claim))
            await this.finish(manager, run, "failed", { code, message });
        });
        this.logger.warn(`运行失败 runId=${scope.runId} code=${code}`);
      }
    } finally {
      this.running.delete(scope.runId);
    }
    await this.publishResult(scopedOwner, scope.runId);
  };

  dispatch = (ownerId: string, run: RunResult) => {
    if (run.status !== "queued" || this.closing) return;
    const previous = this.dispatched.get(run.id);
    const launch = async () => {
      try {
        await previous;
        if (!this.closing) await this.execute(ownerId, run.id);
      } catch {
        this.logger.warn(`运行调度异常 runId=${run.id}`);
      }
    };
    const queued = launch();
    this.dispatched.set(run.id, queued);
    const release = async () => {
      await queued;
      if (this.dispatched.get(run.id) === queued) this.dispatched.delete(run.id);
    };
    void release();
  };

  private publishResult = async (ownerId: string, runId: string) => {
    const snapshot = await this.snapshot(ownerId, runId);
    this.events.settle(snapshot, snapshot.traceId ?? randomUUID());
  };

  private claim = async (
    ownerId: string,
    scope: { runId: string },
  ): Promise<ClaimedRun | null> => {
    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(manager, ownerId, scope);
      const run = await manager.findOneByOrFail(RunEntity, {
        uuid: scope.runId,
        conversationId: conversation.id,
      });
      if ((await this.expire(manager, run)) || run.status !== "queued")
        return null;

      const metadata = RunMetadata.parse(run.metadata ?? {});
      const { user, assistant } = await getRunMessages(manager, run);
      const project = await manager.findOneByOrFail(ProjectEntity, {
        id: conversation.projectId,
      });
      const state = await manager.findOneBy(AgentStateEntity, {
        conversationId: conversation.id,
      });
      const exclude = [
        user.id,
        assistant.id,
        ...(metadata.response ? [metadata.response.messageId] : []),
      ];
      const history = await manager
        .getRepository(MessageEntity)
        .createQueryBuilder("message")
        .where("message.conversation_id = :conversationId", {
          conversationId: conversation.id,
        })
        .andWhere("message.id NOT IN (:...exclude)", { exclude })
        .andWhere(
          "message.role IN ('user', 'assistant') AND message.content <> ''",
        )
        .orderBy("message.created_at", "DESC")
        .addOrderBy("message.id", "DESC")
        .take(AGENT_HISTORY_LIMIT)
        .getMany();

      const draft = GraphInput.nullable().safeParse(
        conversation.currentDraftGraph,
      );
      if (!draft.success) {
        await this.finish(manager, run, "failed", {
          code: ERROR_CODES.GRAPH_INVALID,
          message: "当前画布的数据无效，请修复画布后重试",
        });
        return null;
      }
      const parsedTurn = AgentTurn.safeParse({
        runId: run.uuid,
        conversationId: conversation.uuid,
        projectId: project.uuid,
        input: user.content,
        attachments: metadata.attachments,
        history: history
          .reverse()
          .map(({ role, content }) => ({ role, content })),
        draftGraph: draft.data,
        draftVersion: conversation.draftVersion,
        ...(metadata.graphReferenceMessageId ? {
          referencedGraph: await this.referencedGraph(manager, conversation.id, metadata.graphReferenceMessageId),
        } : {}),
        constraints: state?.constraintsData ?? {},
      });
      if (!parsedTurn.success) {
        await this.finish(manager, run, "failed", {
          code: ERROR_CODES.RUN_NOT_RESUMABLE,
          message: "会话状态无效，请重新发送请求",
        });
        return null;
      }
      const resume =
        metadata.checkpoint && metadata.response
          ? {
              checkpoint: metadata.checkpoint,
              answer: metadata.response.answer,
            }
          : undefined;
      const token = randomUUID();
      metadata.lease = {
        token,
        expiresAt: new Date(Date.now() + LEASE_TIMEOUT_MS).toISOString(),
      };
      run.status = "running";
      run.metadata = metadata;
      await manager.save(RunEntity, run);
      await manager.save(MessageEntity, { id: assistant.id, draftGraphContext: { graph: draft.data } });
      return {
        turn: parsedTurn.data,
        resume,
        token,
        stateVersion: state?.version ?? 0,
        snapshot: await snapshotRun(manager, run, conversation),
      };
    });
  };

  private commit = async (
    ownerId: string,
    scope: { runId: string },
    claim: ClaimedRun,
    result: AgentTurnResult,
  ) => {
    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(manager, ownerId, scope);
      const run = await manager.findOneByOrFail(RunEntity, {
        uuid: scope.runId,
        conversationId: conversation.id,
      });
      if (!this.ownsClaim(run, claim) || (await this.expire(manager, run)))
        return null;

      const state = await manager.findOneBy(AgentStateEntity, {
        conversationId: conversation.id,
      });
      if ((state?.version ?? 0) !== claim.stateVersion) {
        await this.finish(manager, run, "failed", {
          code: ERROR_CODES.RUN_NOT_RESUMABLE,
          message: "会话约束已更新，请重新发送请求",
        });
        return null;
      }

      const now = new Date();
      const graph =
        result.status === "succeeded" && result.graph
          ? GraphInput.parse(result.graph)
          : null;
      if (graph) {
        const nodeIds = new Set(graph.nodes.map(({ id }) => id));
        const layout = DraftLayout.nullable().safeParse(conversation.currentDraftLayout);
        const saved = await manager.update(
          ConversationEntity,
          { id: conversation.id, draftVersion: claim.turn.draftVersion },
          {
            currentDraftGraph: graph,
            currentDraftLayout: layout.data?.filter(({ nodeId }) => nodeIds.has(nodeId)) ?? null,
            draftVersion: claim.turn.draftVersion + 1,
            updatedAt: now,
          },
        );
        if (saved.affected !== 1) {
          await this.finish(manager, run, "failed", {
            code: ERROR_CODES.DRAFT_VERSION_CONFLICT,
            message: "画布已有更新，请基于当前画布重试",
          });
          return null;
        }
      } else {
        await manager.update(ConversationEntity, conversation.id, {
          updatedAt: now,
        });
      }

      await manager.save(AgentStateEntity, {
        id: state?.id,
        conversationId: conversation.id,
        currentStep: result.status,
        version: claim.stateVersion + 1,
        constraintsData: result.constraints,
      });

      const { assistant } = await getRunMessages(manager, run);
      const messageMetadata = MessageMetadata.parse(assistant.metadata ?? {});
      const metadata = RunMetadata.parse(run.metadata ?? {});
      if (result.status === "waiting_input") {
        const interrupt = Interrupt.parse({
          interruptId: randomUUID(),
          kind: "clarification",
          node: "resolve_intent",
          payload: { question: result.checkpoint.question },
          expiresAt: new Date(
            now.getTime() + INTERRUPT_TIMEOUT_MS,
          ).toISOString(),
        });
        const options = clarificationOptions(result);
        messageMetadata.card = {
          id: interrupt.interruptId,
          messageId: assistant.uuid,
          kind: options.length ? "single" : "text",
          title: result.checkpoint.question,
          options,
          status: "pending",
          answer: null,
          createdAt: now.toISOString(),
          answeredAt: null,
        };
        await manager.update(MessageEntity, assistant.id, {
          content: result.text,
          metadata: messageMetadata,
        });
        delete metadata.lease;
        delete metadata.response;
        metadata.interrupt = interrupt;
        metadata.checkpoint = result.checkpoint;
        metadata.streamSequence = Math.max(metadata.streamSequence, this.events.sequence(run.uuid) + RESULT_FRAME_LIMIT);
        run.status = "waiting_input";
        run.metadata = metadata;
        await manager.save(RunEntity, run);
        return null;
      }

      await manager.update(MessageEntity, assistant.id, {
        content: result.text,
        graphSnapshot: graph,
        ...(graph ? { draftGraphContext: null } : {}),
        metadata: { ...messageMetadata, citations: result.citations },
      });
      await this.finish(manager, run, "succeeded");
      return {
        assistantId: assistant.id,
        conversationId: conversation.id,
        title: conversation.title,
        updatedAt: now,
      };
    });
  };

  active = async (ownerId: string, conversationId: string): Promise<ActiveRun> => {
    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(manager, resourceId(ownerId), { conversationId: resourceId(conversationId) });
      const runs = manager.getRepository(RunEntity);
      const latest = await runs.findOne({ where: { conversationId: conversation.id }, order: { id: "DESC" } });
      if (!latest) return { run: null, latest: null };
      await this.expire(manager, latest);
      const handle = acceptedRun((await snapshotRun(manager, latest, conversation)).run);
      return { run: RUN_ACTIVE_STATUSES.includes(latest.status) ? handle : null, latest: handle };
    });
  };

  snapshot = async (ownerId: string, runId: string) => {
    const scope = { runId: resourceId(runId) };
    return this.database.dataSource.transaction(async (manager) => {
      const conversation = await getOwnedConversation(
        manager,
        resourceId(ownerId),
        scope,
      );
      const run = await manager.findOneByOrFail(RunEntity, {
        uuid: scope.runId,
        conversationId: conversation.id,
      });
      await this.expire(manager, run);
      return snapshotRun(manager, run, conversation);
    });
  };

  cancel = async (ownerId: string, runId: string) => {
    const scope = { runId: resourceId(runId) };
    const accepted = await this.database.dataSource.transaction(
      async (manager) => {
        const conversation = await getOwnedConversation(
          manager,
          resourceId(ownerId),
          scope,
        );
        const run = await manager.findOneByOrFail(RunEntity, {
          uuid: scope.runId,
          conversationId: conversation.id,
        });
        if (RUN_ACTIVE_STATUSES.includes(run.status))
          await this.finish(manager, run, "canceled");
        return (await snapshotRun(manager, run, conversation)).run;
      },
    );
    if (accepted.status === "canceled") {
      this.running.get(scope.runId)?.abort();
      await this.publishResult(resourceId(ownerId), scope.runId);
    }
    return accepted;
  };

  onApplicationBootstrap = async () => {
    const result = await this.database.dataSource.createQueryBuilder().update(RunEntity)
      .set({
        status: "failed",
        finishReason: "error",
        errorCode: ERROR_CODES.RUN_NOT_RESUMABLE,
        errorMessage: "服务重启中断了这次任务，已保存的回答仍可查看。请重新发送。",
        finishedAt: new Date(),
        metadata: () => "metadata - 'lease' - 'checkpoint' - 'interrupt' - 'response'",
      })
      .where({ status: In(["queued", "running"]) })
      .execute();
    if (result.affected) this.logger.warn(`服务恢复了 ${result.affected} 条被中断的运行记录`);
  };

  onModuleDestroy = async () => {
    this.closing = true;
    for (const controller of this.running.values()) controller.abort();
    await Promise.allSettled(this.dispatched.values());
  };

  private requireEngine = (): RunEngine => {
    if (!this.engine)
      throw runException(
        503,
        ERROR_CODES.SERVICE_UNAVAILABLE,
        "Agent 尚未配置模型服务",
      );
    return this.engine;
  };

  private ownsClaim = (run: RunEntity, claim: ClaimedRun) =>
    run.status === "running" &&
    RunMetadata.parse(run.metadata).lease?.token === claim.token;

  private expire = async (
    manager: EntityManager,
    run: RunEntity,
  ): Promise<boolean> => {
    const metadata = RunMetadata.parse(run.metadata ?? {});
    if (
      run.status === "running" &&
      (!metadata.lease || hasExpired(metadata.lease.expiresAt))
    ) {
      await this.finish(manager, run, "failed", {
        code: ERROR_CODES.RUN_NOT_RESUMABLE,
        message: "运行超时，请重新发起请求",
      });
      return true;
    }
    if (
      run.status === "waiting_input" &&
      hasExpired(metadata.interrupt?.expiresAt)
    ) {
      await this.finish(manager, run, "canceled");
      return true;
    }
    return false;
  };

  private finish = async (
    manager: EntityManager,
    run: RunEntity,
    status: "succeeded" | "failed" | "canceled",
    error?: { code: string; message: string },
  ) => {
    const metadata = RunMetadata.parse(run.metadata ?? {});
    if (run.status === "waiting_input") {
      const { assistant } = await getRunMessages(manager, run);
      const messageMetadata = MessageMetadata.parse(assistant.metadata ?? {});
      if (messageMetadata.card?.status === "pending") {
        messageMetadata.card.status = hasExpired(metadata.interrupt?.expiresAt)
          ? "expired"
          : "ignored";
        await manager.update(MessageEntity, assistant.id, {
          metadata: messageMetadata,
        });
      }
    }

    delete metadata.checkpoint;
    delete metadata.interrupt;
    delete metadata.lease;
    delete metadata.response;
    metadata.streamSequence = Math.max(metadata.streamSequence, this.events.sequence(run.uuid) + RESULT_FRAME_LIMIT);
    Object.assign(run, {
      status,
      metadata,
      finishReason:
        status === "succeeded"
          ? "stop"
          : status === "failed"
            ? "error"
            : "canceled",
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
      finishedAt: new Date(),
    });
    await manager.save(RunEntity, run);
  };

  private persistExtras = async (
    engine: RunEngine,
    claim: ClaimedRun,
    assistantText: string,
    completion: {
      assistantId: string;
      conversationId: string;
      title: string;
      updatedAt: Date;
    },
  ) => {
    const includeTitle = completion.title === DEFAULT_TITLE;
    const extras = await engine.generateExtras(
      { userInput: claim.turn.input, assistantText, includeTitle },
      AbortSignal.timeout(EXTRAS_TIMEOUT_MS),
    );
    await this.database.dataSource.transaction(async (manager) => {
      const conversation = await manager.findOne(ConversationEntity, {
        where: { id: completion.conversationId },
        lock: { mode: "pessimistic_write" },
      });
      if (!conversation) return;
      const assistant = await manager.findOneBy(MessageEntity, {
        id: completion.assistantId,
        conversationId: completion.conversationId,
      });
      if (!assistant) return;
      const metadata = MessageMetadata.parse(assistant.metadata ?? {});
      await manager.update(MessageEntity, assistant.id, {
        metadata: {
          ...metadata,
          suggestedQuestions: extras.suggestedQuestions,
        },
      });
      if (includeTitle && extras.title) {
        await manager.update(
          ConversationEntity,
          {
            id: completion.conversationId,
            title: DEFAULT_TITLE,
            updatedAt: completion.updatedAt,
          },
          {
            title: extras.title,
            updatedAt: completion.updatedAt,
          },
        );
      }
    });
  };
}
