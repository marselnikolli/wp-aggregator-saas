import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect } from 'react'
import { Bold, Italic, Strikethrough, List, ListOrdered, Heading2, Heading3, Link as LinkIcon, Image as ImageIcon, Undo, Redo, Code } from 'lucide-react'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

function ToolbarBtn({ onClick, active, title, children }: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick() }}
      title={title}
      className={`p-1.5 rounded text-sm transition-colors ${active ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
    >
      {children}
    </button>
  )
}

export function RichTextEditor({ value, onChange, placeholder = 'Write content…' }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Image.configure({ inline: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  // Sync external value changes (e.g. when post selection changes)
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value)
    }
  }, [value, editor])

  if (!editor) return null

  const setLink = () => {
    const prev = editor.getAttributes('link').href as string ?? ''
    const url = window.prompt('URL', prev)
    if (url === null) return
    if (url === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const addImage = () => {
    const url = window.prompt('Image URL')
    if (url) editor.chain().focus().setImage({ src: url }).run()
  }

  return (
    <div className="flex flex-col border border-border rounded-md overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-secondary/30">
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
          <Bold className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
          <Italic className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
          <Strikethrough className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
          <Code className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
          <Heading2 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
          <Heading3 className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
          <List className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered list">
          <ListOrdered className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarBtn onClick={setLink} active={editor.isActive('link')} title="Insert link">
          <LinkIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={addImage} active={false} title="Insert image">
          <ImageIcon className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <div className="w-px h-4 bg-border mx-1" />
        <ToolbarBtn onClick={() => editor.chain().focus().undo().run()} active={false} title="Undo">
          <Undo className="h-3.5 w-3.5" />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => editor.chain().focus().redo().run()} active={false} title="Redo">
          <Redo className="h-3.5 w-3.5" />
        </ToolbarBtn>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-sm prose-invert max-w-none p-3 min-h-[220px] max-h-[480px] overflow-y-auto focus-within:outline-none text-sm [&_.ProseMirror]:outline-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:h-0"
      />
    </div>
  )
}
