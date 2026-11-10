import { SystemDialogError, type LocalFile, type ZoneContent } from './content'
import { ensureUploaded, importFiles, releaseImportSession, type StartUploadOptions } from './ndm_client'

export interface EnsureObjIdOptions extends Pick<StartUploadOptions, 'endpoint' | 'sessionToken' | 'fetcher' | 'headers' | 'signal'> {}

/**
 * The object ID of an item the system file picker returned: the one it already carries, or one computed and
 * registered in the Zone. A file from this device goes through `ndm.importFiles` + `ndm.ensureUploaded`; call
 * `release()` once your own data references the object. A Zone item without an ID needs the server-side `snapshot`
 * of nfs_server, which this Zone does not offer yet: that case rejects with `SystemDialogError('unsupported')`.
 */
export async function ensureObjId(item: ZoneContent | LocalFile, options: EnsureObjIdOptions = {}): Promise<{ objId: string; release(): void }> {
  if (item.origin === 'zone') {
    if (item.objId) return { objId: item.objId, release() {} }
    throw new SystemDialogError('unsupported', 'This Zone cannot compute the object ID of a Zone file yet')
  }
  const snapshot = await importFiles([item.file], { mode: 'single_file', ...options })
  let released = false
  const release = () => { if (!released) { released = true; releaseImportSession(snapshot.sessionId) } }
  try { await ensureUploaded(snapshot.sessionId, options) }
  catch (error) { release(); throw error }
  return { objId: snapshot.selection.objectId, release }
}
