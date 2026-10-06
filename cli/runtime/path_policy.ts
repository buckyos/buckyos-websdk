import { type DistributionPolicy, HostError, type HostPath, isHostError } from './host.ts'

export async function assertPathAccess(
  policy: DistributionPolicy,
  path: HostPath,
  realPath: (value: string) => Promise<string>,
  candidate: string,
  operation: 'read' | 'write',
  resolveLinks = true,
): Promise<void> {
  const roots = operation === 'read' ? policy.readPaths : policy.writePaths
  const absolute = path.resolve(candidate)
  const physicalRoots: string[] = []
  for (const root of roots) {
    try {
      physicalRoots.push(await realPath(path.resolve(root)))
    } catch (error) {
      if (!isHostError(error, 'NotFound') && !isHostError(error, 'PermissionDenied')) throw error
    }
  }
  if (!insideAny(absolute, roots, path) && !insideAny(absolute, physicalRoots, path)) {
    throw new HostError(
      'PermissionDenied',
      `${operation} access is outside ${policy.name}: ${absolute}`,
      absolute,
    )
  }
  if (!resolveLinks) return
  try {
    const physical = await realPath(absolute)
    if (!insideAny(physical, physicalRoots, path)) {
      throw new HostError(
        'PermissionDenied',
        `${operation} access escapes ${policy.name}: ${absolute}`,
        absolute,
      )
    }
  } catch (error) {
    if (!isHostError(error, 'NotFound')) throw error
  }
}

function insideAny(candidate: string, roots: readonly string[], path: HostPath): boolean {
  return roots.some((root) => {
    const relative = path.relative(path.resolve(root), candidate)
    return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
  })
}
