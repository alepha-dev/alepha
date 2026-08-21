import { useClient } from "alepha/react";
import { useCallback } from "react";

import type { QuestController } from "@/api/controllers/QuestController.ts";

/**
 * Image upload handler for quest-side markdown surfaces (description,
 * notes, completion message).
 *
 * Uploads to the quest-attachments bucket and returns the embeddable URL.
 * No client-side linking: the server scans saved markdown for
 * `/api/files/<uuid>` and merges the ids into `quest.attachments`, which
 * is what makes the file readable by every project member.
 */
export const useQuestImageUpload = (): ((file: File) => Promise<string>) => {
  const questApi = useClient<QuestController>();

  return useCallback(
    async (file: File) => {
      const uploaded = await questApi.uploadAttachment({ body: { file } });
      return uploaded.url;
    },
    [questApi],
  );
};
