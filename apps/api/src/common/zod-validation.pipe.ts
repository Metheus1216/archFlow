import { Injectable, Optional, type ArgumentMetadata, type PipeTransform, type Type } from "@nestjs/common";
import { z } from "zod";
import {
  ERROR_CODES,
  mapGraphError,
  type FieldError,
  type GraphError,
} from "@arch-flow/shared";

type ZodSchemaCarrier = {
  zodSchema?: z.ZodType;
};

export type ZodValidationPipeOptions = {
  /** 请求体是否为图数据；为 true 时把结构错误映射为 422 GRAPH_INVALID。 */
  graph?: boolean;
};

const schemaFromMetatype = (
  metatype?: Type<unknown>,
): z.ZodType | undefined =>
  (metatype as (Type<unknown> & ZodSchemaCarrier) | undefined)?.zodSchema;

const formatFieldPath = (path: PropertyKey[]): string =>
  path.reduce<string>((accumulator, key) => {
    if (typeof key === "number") {
      return `${accumulator}[${key}]`;
    }

    return accumulator
      ? `${accumulator}.${String(key)}`
      : String(key);
  }, "");

export const toFieldErrors = (issues: z.ZodIssue[]): FieldError[] =>
  issues.map((issue) => ({
    field: formatFieldPath(issue.path) || "body",
    code: ERROR_CODES.VALIDATION_FAILED,
    message: issue.message,
  }));

/** 校验失败异常：由全局过滤器统一转成 ApiResponse 外壳。 */
export class ZodValidationException extends Error {
  readonly issues: z.ZodIssue[];
  readonly graphError?: GraphError;

  constructor(error: z.ZodError, isGraph = false) {
    super("请求参数不合法");
    this.name = "ZodValidationException";
    this.issues = error.issues;

    const hasGraphIssue =
      isGraph ||
      error.issues.some((issue) => {
        const params = (issue as { params?: { errorCode?: unknown } }).params;

        return (
          typeof params?.errorCode === "string" ||
          issue.path[0] === "graph"
        );
      });

    this.graphError = hasGraphIssue ? mapGraphError(error) : undefined;
  }
}

/**
 * Zod 校验管道。
 *
 * 两种用法：
 * 1. 全局注册后，DTO 类声明 `static readonly zodSchema = XxxInput`；
 * 2. Controller 里 `@Body(new ZodValidationPipe(XxxInput))`。
 *
 * 找不到 schema 时原样放行，避免影响路径参数、文件流等非 DTO 入参。
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(
    @Optional() private readonly schema?: z.ZodType,
    @Optional() private readonly options: ZodValidationPipeOptions = {},
  ) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = this.schema ?? schemaFromMetatype(metadata.metatype);

    if (!schema) {
      return value;
    }

    const result = schema.safeParse(value);

    if (!result.success) {
      throw new ZodValidationException(result.error, this.options.graph === true);
    }

    return result.data;
  }
}
