"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { FILE_UPLOAD_EXTENSIONS } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { FILE_UPLOAD_LIMIT_MIB, getUploadFileError, useUploadProjectFile } from "@/hooks/use-project-files";
import { ApiError } from "@/lib/api-client";

const UNCONFIRMED_UPLOAD = "暂时无法确认上传结果。可用同一个文件重试，不会重复保存。";
const STOPPED_UPLOAD = "已停止等待上传。若服务器已收到文件，重试不会重复保存。";
const ACCEPTED_EXTENSIONS = FILE_UPLOAD_EXTENSIONS.join(",");

type ProjectFileUploadProps = {
  projectId: string;
  projectName: string;
};

export const ProjectFileUpload = ({ projectId, projectName }: ProjectFileUploadProps) => {
  const ownerId = useAuth().user?.id;
  const upload = useUploadProjectFile();
  const inputId = useId();
  const active = useRef<AbortController | null>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const validation = file ? getUploadFileError(file) : null;

  useEffect(() => () => {
    active.current?.abort();
    active.current = null;
  }, []);

  const changeOpen = (next: boolean) => {
    if (active.current) return;
    setOpen(next);
    setFile(null);
    setFailure(null);
    upload.reset();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ownerId || !file || validation || active.current) return;

    const controller = new AbortController();
    active.current = controller;
    setFailure(null);
    try {
      await upload.mutateAsync({ ownerId, projectId, file, signal: controller.signal });
      controller.signal.throwIfAborted();
      if (active.current !== controller) return;
      active.current = null;
      changeOpen(false);
    } catch (error) {
      if (active.current !== controller) return;
      setFailure(controller.signal.aborted ? STOPPED_UPLOAD : error instanceof ApiError ? error.message : UNCONFIRMED_UPLOAD);
    } finally {
      if (active.current === controller) active.current = null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-6 px-2" aria-label={`上传资料到${projectName}`}>
          上传资料
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm" showCloseButton={!upload.isPending}>
        <DialogHeader>
          <DialogTitle>上传项目资料</DialogTitle>
          <DialogDescription className="wrap-anywhere">
            文件只添加到「{projectName}」。文本解析后可引用；图片仅检查能否读取，不参与检索；PDF 和 DOCX 仅存储。
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex min-w-0 flex-col gap-1.5" data-invalid={Boolean(validation)}>
            <label htmlFor={inputId} className="text-xs font-medium">选择文件</label>
            <Input
              id={inputId}
              name="file"
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              className="min-w-0 py-2"
              disabled={upload.isPending}
              aria-invalid={Boolean(validation)}
              aria-describedby={validation ? `${inputId}-limits ${inputId}-error` : `${inputId}-limits`}
              onChange={(event) => {
                setFile(event.currentTarget.files?.item(0) ?? null);
                setFailure(null);
              }}
            />
            <p id={`${inputId}-limits`} className="text-[11px] leading-5 text-muted-foreground">
              支持 {FILE_UPLOAD_EXTENSIONS.join("、")}，单个文件最大 {FILE_UPLOAD_LIMIT_MIB} MB。
            </p>
            {validation && <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">{validation}</p>}
            {failure && <p role="alert" className="wrap-anywhere text-xs text-destructive">{failure}</p>}
            {upload.isPending && <p role="status" className="text-xs text-muted-foreground">正在上传文件…</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => {
              if (active.current) active.current.abort();
              else changeOpen(false);
            }}>
              {upload.isPending ? "取消上传" : "取消"}
            </Button>
            <Button type="submit" size="sm" disabled={!ownerId || !file || Boolean(validation) || upload.isPending}>
              {upload.isPending ? "正在上传…" : failure ? "重试上传" : "上传文件"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
