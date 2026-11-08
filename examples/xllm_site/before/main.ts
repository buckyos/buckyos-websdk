import { notesApi } from '../notes_api'

let current: string | undefined

function render() {
  const list = document.getElementById('list') as HTMLUListElement
  list.innerHTML = ''
  for (const n of notesApi.list()) {
    const li = document.createElement('li')
    li.textContent = n.title
    li.dataset.id = n.id
    li.onclick = () => select(n.id)
    list.appendChild(li)
  }
  if (current && notesApi.list().some(n => n.id === current)) select(current)
}

function select(id: string) {
  current = id
  const n = notesApi.get(id)
  ;(document.getElementById('title') as HTMLElement).textContent = n.title
  ;(document.getElementById('body') as HTMLTextAreaElement).value = n.body
}

document.getElementById('save')?.addEventListener('click', () => {
  if (current) notesApi.update(current, (document.getElementById('body') as HTMLTextAreaElement).value)
})
document.getElementById('delete')?.addEventListener('click', () => {
  if (current) notesApi.remove(current)
  current = undefined
})
document.getElementById('export')?.addEventListener('click', () => {
  ;(document.getElementById('exported') as HTMLElement).textContent = notesApi.exportMarkdown()
})

notesApi.onChange(render)
render()
