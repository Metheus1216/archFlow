"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { AssetInput } from "@arch-flow/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  useSaveProjectAsset,
  type ProjectAssetSubmission,
} from "@/hooks/use-project-asset";
import { ApiError } from "@/lib/api-client";
import type { AssetSaveSnapshot } from "./asset-save-snapshot";

type SaveAssetFormProps = {
  snapshot: AssetSaveSnapshot;
  pending: boolean;
  error: Error | null;
  onClearError: () => void;
  onClose: () => void;
  onSubmit: (submission: ProjectAssetSubmission) => void;
};

const SaveAssetForm = ({
  snapshot,
  pending,
  error,
  onClearError,
  onClose,
  onSubmit,
}: SaveAssetFormProps) => {
  const nameId = useId();
  const [name, setName] = useState(snapshot.initialName);
  const [invalidSnapshot, setInvalidSnapshot] = useState(false);
  const nameSchema = AssetInput.shape.name;
  const validName = nameSchema.safeParse(name).success;
  const problem = invalidSnapshot
    ? "这张架构图无法保存。请检查节点位置后重试。"
    : error instanceof ApiError
      ? error.message
      : error
        ? "保存失败，请重试。"
        : null;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validName || pending) return;

    const submission = snapshot.prepare(name);
    if (!submission) {
      setInvalidSnapshot(true);
      return;
    }
    onSubmit(submission);
  };

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit} aria-busy={pending}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="text-xs font-medium">
          资产名称
        </label>
        <Input
          id={nameId}
          value={name}
          maxLength={nameSchema.maxLength ?? undefined}
          disabled={pending}
          aria-invalid={!validName}
          aria-describedby={validName ? undefined : `${nameId}-error`}
          onChange={(event) => {
            setName(event.target.value);
            if (error) onClearError();
          }}
        />
        {!validName && (
          <p id={`${nameId}-error`} className="text-xs text-destructive">
            请输入有效的资产名称。
          </p>
        )}
        {problem && (
          <p role="alert" className="text-xs text-destructive">
            {problem}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" disabled={pending} onClick={onClose}>
          取消
        </Button>
        <Button type="submit" size="sm" disabled={!validName || pending}>
          {pending ? "正在保存…" : "保存资产"}
        </Button>
      </DialogFooter>
    </form>
  );
};

type SaveAssetDialogProps = {
  snapshot: AssetSaveSnapshot | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

export const SaveAssetDialog = ({
  snapshot,
  onClose,
  onCloseAutoFocus,
}: SaveAssetDialogProps) => {
  const saveAsset = useSaveProjectAsset();
  const submitting = useRef(false);

  const close = () => {
    if (submitting.current) return;
    saveAsset.reset();
    onClose();
  };

  const submit = (submission: ProjectAssetSubmission) => {
    if (submitting.current) return;
    submitting.current = true;
    saveAsset.mutate(submission, {
      onSuccess: onClose,
      onSettled: () => {
        submitting.current = false;
      },
    });
  };

  return (
    <Dialog open={snapshot !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="sm:max-w-sm"
        showCloseButton={!saveAsset.isPending}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>保存为项目资产</DialogTitle>
          <DialogDescription>保存当前架构图和节点位置。</DialogDescription>
        </DialogHeader>
        {snapshot && (
          <SaveAssetForm
            snapshot={snapshot}
            pending={saveAsset.isPending}
            error={saveAsset.error}
            onClearError={saveAsset.reset}
            onClose={close}
            onSubmit={submit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
