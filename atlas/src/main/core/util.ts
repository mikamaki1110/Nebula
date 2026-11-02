/** PowerShell liefert bei einem Treffer ein Objekt, bei mehreren eine Liste, bei keinem null – hier alles zur Liste machen. */
export const arr = <T>(x: T[] | T | null | undefined): T[] => (x == null ? [] : Array.isArray(x) ? x : [x])
