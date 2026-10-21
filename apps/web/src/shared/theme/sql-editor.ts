import { EditorView } from 'codemirror'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export const sqlHighlighting = syntaxHighlighting(
  HighlightStyle.define(
    [
      { tag: [tags.keyword, tags.typeName], color: 'var(--editorKeyword)' },
      { tag: tags.string, color: 'var(--editorString)' },
      { tag: [tags.number, tags.bool, tags.null], color: 'var(--editorNumber)' },
      { tag: tags.comment, color: 'var(--editorComment)', fontStyle: 'italic' },
    ],
    { all: { color: 'var(--textPrimary)' } },
  ),
)

export function sqlEditorTheme(dark: boolean) {
  return EditorView.theme(
    {
      '&': { backgroundColor: 'var(--surfaceRaised)', color: 'var(--textPrimary)' },
      '.cm-content': { caretColor: 'var(--textPrimary)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--textPrimary)' },
      '.cm-gutters': {
        backgroundColor: 'var(--surface)',
        color: 'var(--editorComment)',
        borderRightColor: 'var(--border)',
      },
      '.cm-activeLine': {
        // Selection is drawn behind the text line; an opaque line background hides it.
        backgroundColor: 'color-mix(in srgb, var(--accent) 4%, transparent)',
      },
      '.cm-activeLineGutter': { backgroundColor: 'var(--surface)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
        backgroundColor: 'var(--editorSelection) !important',
      },
      '.cm-content ::selection, .cm-content::selection': {
        backgroundColor: 'var(--editorSelection)',
      },
      '&.cm-focused .cm-matchingBracket': {
        backgroundColor: 'var(--accentSoft)',
        outline: '1px solid var(--accent)',
      },
      '.cm-panels, .cm-tooltip': {
        backgroundColor: 'var(--surfaceRaised)',
        color: 'var(--textPrimary)',
        borderColor: 'var(--border)',
      },
      '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accentSoft)',
        color: 'var(--textPrimary)',
      },
    },
    { dark },
  )
}
