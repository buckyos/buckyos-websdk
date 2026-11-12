import { SystemDialogError } from "./content.mjs";
import { ct as importFiles, cu as ensureUploaded, cv as releaseImportSession } from "./executor_client-66c2480f.mjs";
async function ensureObjId(item, options = {}) {
  if (item.origin === "zone") {
    if (item.objId)
      return { objId: item.objId, release() {
      } };
    throw new SystemDialogError("unsupported", "This Zone cannot compute the object ID of a Zone file yet");
  }
  const snapshot = await importFiles([item.file], { mode: "single_file", ...options });
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      releaseImportSession(snapshot.sessionId);
    }
  };
  try {
    await ensureUploaded(snapshot.sessionId, options);
  } catch (error) {
    release();
    throw error;
  }
  return { objId: snapshot.selection.objectId, release };
}
export {
  ensureObjId as e
};
//# sourceMappingURL=content_objid-987e3386.mjs.map
