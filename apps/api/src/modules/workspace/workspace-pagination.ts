import type { UuidEntity } from "@arch-flow/db";
import { ERROR_CODES, ISODateTime, type Page, type PaginationQuery } from "@arch-flow/shared";
import type { SelectQueryBuilder } from "typeorm";
import { z } from "zod";
import { apiError } from "../../common/api-response.js";

const CURSOR = z.object({ uuid: z.uuid(), timestamp: ISODateTime });

const invalidCursor = () => apiError(400, ERROR_CODES.VALIDATION_FAILED, "分页游标无效，请重新加载列表。");

const readCursor = (cursor: string): z.infer<typeof CURSOR> => {
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw invalidCursor();
    return CURSOR.parse(JSON.parse(decoded.toString("utf8")));
  } catch {
    throw invalidCursor();
  }
};

export const paginateWorkspaceRows = async <Row extends UuidEntity>(
  query: SelectQueryBuilder<Row>,
  { limit, cursor }: PaginationQuery,
  timestamp: "created_at" | "updated_at",
  order: "ASC" | "DESC" = "DESC",
): Promise<Page<Row>> => {
  const { alias } = query;
  const timestampColumn = `${alias}.${timestamp}`;
  if (cursor) {
    const anchor = readCursor(cursor);
    const row = await query.clone()
      .andWhere(`${alias}.uuid = :anchorUuid`, { anchorUuid: anchor.uuid })
      .getOne();
    if (!row) throw invalidCursor();
    const comparison = order === "ASC" ? ">" : "<";
    query.andWhere(`(${timestampColumn}, ${alias}.id) ${comparison} (CAST(:anchorTimestamp AS timestamptz), :anchorId)`, {
      anchorTimestamp: anchor.timestamp,
      anchorId: row.id,
    });
  }

  const { entities, raw } = await query
    .addSelect(`to_char(${timestampColumn} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`, "cursor_timestamp")
    .orderBy(timestampColumn, order)
    .addOrderBy(`${alias}.id`, order)
    .limit(limit + 1)
    .getRawAndEntities<{ cursor_timestamp: string }>();
  const hasMore = entities.length > limit;
  const last = entities[limit - 1];

  return {
    items: entities.slice(0, limit),
    nextCursor: hasMore && last
      ? Buffer.from(JSON.stringify({ uuid: last.uuid, timestamp: raw[limit - 1]?.cursor_timestamp })).toString("base64url")
      : null,
    hasMore,
  };
};
