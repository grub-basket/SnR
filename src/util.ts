export function uid(): string { return Math.random().toString(36).slice(2, 9); }
export function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}
export function relTo(folder: string, fullPath: string): string {
  if (!folder) return fullPath;
  return fullPath.startsWith(folder + '/') ? fullPath.slice(folder.length + 1) : fullPath;
}
