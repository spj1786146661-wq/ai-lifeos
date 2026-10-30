export interface LifeSendDraft {
  text: string
  date: string
  image?: {
    name: string
    size: number
    lastModified: number
  } | null
}

export type LifeSendBeginResult =
  | { status: 'accepted'; actionId: string; draftKey: string }
  | { status: 'busy' }
  | { status: 'already-submitted' }

export function lifeSendDraftKey(draft: LifeSendDraft): string {
  return JSON.stringify([
    draft.text.trim(),
    draft.date,
    draft.image
      ? [draft.image.name, draft.image.size, draft.image.lastModified]
      : null,
  ])
}

/**
 * Keeps one stable action ID for an unchanged draft. Editing the draft creates
 * a new identity; a completed unchanged draft cannot be submitted again by a
 * stale button, Enter handler or form event.
 */
export class LifeSendGuard {
  private readonly idFactory: () => string
  private actionId: string
  private submittedDraftKey = ''
  private draftKey = ''
  private inFlight = false

  constructor(idFactory: () => string = () => crypto.randomUUID()) {
    this.idFactory = idFactory
    this.actionId = this.idFactory()
  }

  markDraftEdited(): void {
    if (this.inFlight) return
    this.actionId = this.idFactory()
    this.submittedDraftKey = ''
    this.draftKey = ''
  }

  begin(draft: LifeSendDraft): LifeSendBeginResult {
    if (this.inFlight) return { status: 'busy' }
    const draftKey = lifeSendDraftKey(draft)
    if (draftKey === this.submittedDraftKey) return { status: 'already-submitted' }
    if (this.draftKey && draftKey !== this.draftKey) {
      this.actionId = this.idFactory()
      this.submittedDraftKey = ''
    }
    this.draftKey = draftKey
    this.inFlight = true
    return { status: 'accepted', actionId: this.actionId, draftKey }
  }

  finish(draftKey: string, succeeded: boolean): void {
    this.inFlight = false
    if (succeeded) this.submittedDraftKey = draftKey
  }

  get busy(): boolean {
    return this.inFlight
  }
}
