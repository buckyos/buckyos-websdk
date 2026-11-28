import { SystemDialogError } from "./content.mjs";
import { cY as importFiles, cZ as ensureUploaded, c_ as releaseImportSession } from "./aiws_write-9d2c689c.mjs";
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
//# sourceMappingURL=content_objid-2789a311.mjs.map
