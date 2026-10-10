import { describe, expect, it } from 'vitest'
import { History } from '../../src/renderer/src/audio/history'

describe('History', () => {
  it('undoes and redoes in order', () => {
    const history = new History<string>()
    history.push('a', 10)
    history.push('b', 10)
    expect(history.nextUndo).toBe('b')
    expect(history.undo()).toBe('b')
    expect(history.nextRedo).toBe('b')
    expect(history.undo()).toBe('a')
    expect(history.canUndo).toBe(false)
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBe('a')
    expect(history.redo()).toBe('b')
    expect(history.canRedo).toBe(false)
  })

  it('clears the redo stack when a new step is pushed', () => {
    const history = new History<string>()
    history.push('a', 10)
    history.undo()
    history.push('b', 10)
    expect(history.canRedo).toBe(false)
    expect(history.memoryUsage).toBe(10)
  })

  it('drops the oldest steps when over budget but keeps the latest', () => {
    const history = new History<string>(25)
    history.push('a', 10)
    history.push('b', 10)
    history.push('c', 10)
    expect(history.undoDepth).toBe(2)
    expect(history.memoryUsage).toBe(20)
    history.push('huge', 100)
    expect(history.undoDepth).toBe(1)
    expect(history.nextUndo).toBe('huge')
  })

  it('clears everything', () => {
    const history = new History<string>()
    history.push('a', 10)
    history.clear()
    expect(history.canUndo).toBe(false)
    expect(history.memoryUsage).toBe(0)
  })
})
