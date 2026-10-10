interface Entry<T> {
  readonly value: T
  readonly bytes: number
}

/**
 * Undo/redo stacks with a memory budget. When the budget is exceeded the oldest undo steps
 * are dropped; the most recent step is always kept so the last action can be undone.
 */
export class History<T> {
  private undoStack: Entry<T>[] = []
  private redoStack: Entry<T>[] = []
  private bytes = 0

  constructor(private readonly maxBytes = 512 * 1024 * 1024) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0
  }

  /** The step `undo()` would return next. */
  get nextUndo(): T | undefined {
    return this.undoStack.at(-1)?.value
  }

  /** The step `redo()` would return next. */
  get nextRedo(): T | undefined {
    return this.redoStack.at(-1)?.value
  }

  get undoDepth(): number {
    return this.undoStack.length
  }

  get memoryUsage(): number {
    return this.bytes
  }

  push(value: T, bytes: number): void {
    for (const dropped of this.redoStack) this.bytes -= dropped.bytes
    this.redoStack = []
    this.undoStack.push({ value, bytes })
    this.bytes += bytes
    while (this.bytes > this.maxBytes && this.undoStack.length > 1) {
      this.bytes -= this.undoStack.shift()!.bytes
    }
  }

  /** Moves the latest step to the redo stack and returns it; the caller reverts it. */
  undo(): T | undefined {
    const entry = this.undoStack.pop()
    if (entry) this.redoStack.push(entry)
    return entry?.value
  }

  /** Moves the latest undone step back and returns it; the caller re-applies it. */
  redo(): T | undefined {
    const entry = this.redoStack.pop()
    if (entry) this.undoStack.push(entry)
    return entry?.value
  }

  clear(): void {
    this.undoStack = []
    this.redoStack = []
    this.bytes = 0
  }
}
