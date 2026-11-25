import { ERROR_CODES, FILE_UPLOAD_MAX_BYTES, FileMeta, FileUploadSize, Id } from "@arch-flow/shared";
import { assertMockProjectFileAccess, createMockProjectFile } from "@/lib/mock-project-files";
import { mockOk } from "@/lib/mock-response";
import { MockRunError } from "@/lib/mock-run-data";
import { handleMockRunRoute } from "@/lib/mock-run-route";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ projectId: string }> };

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

const tooLarge = () => new MockRunError(413, ERROR_CODES.FILE_TOO_LARGE, "文件超过上传大小上限，请缩小后重试。");

const readFileForm = async (request: Request) => {
  const contentType = request.headers.get("Content-Type");
  if (!request.body || !contentType || !/^multipart\/form-data\s*;/iu.test(contentType)) {
    throw new MockRunError(400, ERROR_CODES.BAD_REQUEST, "请使用文件上传表单。");
  }
  const maxBodyBytes = FILE_UPLOAD_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;
  if (Number(request.headers.get("Content-Length")) > maxBodyBytes) throw tooLarge();

  let received = 0;
  const body = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform: (chunk, controller) => {
      received += chunk.byteLength;
      if (received > maxBodyBytes) throw tooLarge();
      controller.enqueue(chunk);
    },
  }));

  let form: FormData;
  try {
    form = await new Response(body, { headers: { "Content-Type": contentType } }).formData();
  } catch (error) {
    if (error instanceof MockRunError) throw error;
    throw new MockRunError(400, ERROR_CODES.BAD_REQUEST, "无法读取上传表单，请重新选择文件。");
  }
  const entries = [...form.entries()];
  const first = entries[0];
  if (entries.length !== 1 || first?.[0] !== "file" || !(first[1] instanceof File)) {
    throw new MockRunError(422, ERROR_CODES.VALIDATION_FAILED, "请选择一个文件上传。");
  }
  const file = first[1];
  if (!FileUploadSize.safeParse(file.size).success) {
    if (file.size > FILE_UPLOAD_MAX_BYTES) throw tooLarge();
    throw new MockRunError(422, ERROR_CODES.VALIDATION_FAILED, "无法上传空文件，请选择包含内容的文件。");
  }
  return file;
};

export const POST = (request: Request, { params }: RouteContext) =>
  handleMockRunRoute(request, async (userId) => {
    const projectId = Id.parse((await params).projectId);
    await assertMockProjectFileAccess(userId, projectId);
    const file = await readFileForm(request);
    const result = await createMockProjectFile(userId, projectId, file, request.signal);
    return mockOk(FileMeta, result.file, result.created ? 201 : 200);
  });
