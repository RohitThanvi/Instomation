import { useEffect } from 'react'

/** Lets a form tell the page whether it holds edits that were not saved. */
export type DirtyReporter = (dirty: boolean) => void

/** Reports `dirty` while the form is mounted, and clean again when it goes away (for example after a save). */
export function useReportDirty(dirty: boolean, report: DirtyReporter) {
  useEffect(() => {
    report(dirty)
    return () => {
      report(false)
    }
  }, [dirty, report])
}
