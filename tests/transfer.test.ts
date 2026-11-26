import type { ZoneContent } from '../src/content'
import {
  CONTENT_REFS_FORMAT, TRANSFER_HANDLE_FORMAT, buckyosAddressUri, contentRefsFromHtml, contentRefsRepresentations, embedTransferHandle,
  newOfferId, parseBuckyosAddress, readBuckyosAddresses, readContentRefs, readTransferHandle, readTypedTable, transferHandleFromHtml,
  transferHandleValue, transferReader, typedTableRepresentations, type TypedTable,
} from '../src/transfer'

const pdf: ZoneContent = { origin: 'zone', kind: 'file', source: { kind: 'cyfs-path', path: 'cyfs:///home/alice/My Docs/notes #1.pdf' }, objId: 'cyfile:abc123', hints: { name: 'notes #1.pdf', mime: 'application/pdf', size: 42 } }
const folder: ZoneContent = { origin: 'zone', kind: 'folder', source: { kind: 'cyfs-path', path: 'cyfs:///home/alice/照片' }, hints: { name: '照片' } }
const member: ZoneContent = { origin: 'zone', kind: 'file', source: { kind: 'object-id', objectId: 'cyfile:zip1', innerPath: '/archive/a b.txt' }, hints: { name: 'a b.txt' } }

describe('BuckyOS addresses', () => {
  it('reads cyfs:// paths, decoding escapes and dropping a trailing slash', () => {
    expect(parseBuckyosAddress('cyfs:///home/alice/My Docs/notes %231.pdf')).toEqual({ kind: 'cyfs-path', path: 'cyfs:///home/alice/My Docs/notes #1.pdf' })
    expect(parseBuckyosAddress('  cyfs:///home/alice/%E7%85%A7%E7%89%87/ ')).toEqual({ kind: 'cyfs-path', path: 'cyfs:///home/alice/照片' })
    expect(parseBuckyosAddress('cyfs:///')).toEqual({ kind: 'cyfs-path', path: 'cyfs:///' })
  })
  it('reads obj:// with an archive member', () => {
    expect(parseBuckyosAddress('obj://cyfile:zip1/archive/a%20b.txt')).toEqual({ kind: 'object-id', objectId: 'cyfile:zip1', innerPath: '/archive/a b.txt' })
  })
  it('rejects anything that would escape or is not an address', () => {
    for (const bad of ['cyfs:///home/../etc', 'cyfs:///home/./a', 'cyfs:///a/%2Fb', 'cyfs:///a?x=1', 'cyfs:///a#f', 'cyfs://host/a', 'https://x/y', 'cyfs:///a/%zz', 'cyfs:///a//b', 'obj://not an id', 'obj://cyfile:x/other/y'])
      expect(parseBuckyosAddress(bad)).toBeUndefined()
  })
  it('round-trips through the URI form', () => {
    for (const item of [pdf, folder, member]) expect(parseBuckyosAddress(buckyosAddressUri(item.source))).toEqual(item.source)
  })
  it('takes a text only when every line is an address', () => {
    expect(readBuckyosAddresses('cyfs:///a\r\n\r\ncyfs:///b\n')).toHaveLength(2)
    expect(readBuckyosAddresses('cyfs:///a\nhello')).toBeUndefined()
    expect(readBuckyosAddresses('# comment\ncyfs:///a', { uriList: true })).toHaveLength(1)
    expect(readBuckyosAddresses('# comment\ncyfs:///a')).toBeUndefined()
  })
})

describe('Zone content reference list', () => {
  const reps = contentRefsRepresentations([pdf, folder, member])
  it('writes the list, names, addresses and marked links in order', () => {
    expect(JSON.parse(reps[CONTENT_REFS_FORMAT])).toEqual({ v: 1, items: [pdf, folder, member] })
    expect(reps['text/plain']).toBe('notes #1.pdf\n照片\na b.txt')
    expect(reps['text/uri-list'].split('\r\n')).toEqual(['cyfs:///home/alice/My%20Docs/notes%20%231.pdf', 'cyfs:///home/alice/%E7%85%A7%E7%89%87', 'obj://cyfile:zip1/archive/a%20b.txt'])
    expect(reps['text/plain']).not.toMatch(/cyfile|\{/)
  })
  it('reads the list back and refuses other versions or damaged items', () => {
    expect(readContentRefs(reps[CONTENT_REFS_FORMAT])).toEqual([pdf, folder, member])
    expect(readContentRefs(JSON.stringify({ v: 2, items: [pdf] }))).toBeUndefined()
    expect(readContentRefs(JSON.stringify({ v: 1, items: [] }))).toBeUndefined()
    expect(readContentRefs(JSON.stringify({ v: 1, items: [{ ...pdf, source: { kind: 'cyfs-path', path: 'https://x' } }] }))).toBeUndefined()
    expect(readContentRefs('{')).toBeUndefined()
  })
  it('recovers addresses and kinds from the HTML links when the MIME type was dropped', () => {
    expect(contentRefsFromHtml(reps['text/html'])).toEqual([
      { origin: 'zone', kind: 'file', source: pdf.source, hints: { name: 'notes #1.pdf' } },
      { origin: 'zone', kind: 'folder', source: folder.source, hints: { name: '照片' } },
      { origin: 'zone', kind: 'file', source: member.source, hints: { name: 'a b.txt' } },
    ])
    // the way Chromium hands a sanitized copy back
    const wrapped = `<html><body><!--StartFragment-->${reps['text/html'].replace('<meta charset="utf-8">', '')}<!--EndFragment--></body></html>`
    expect(contentRefsFromHtml(wrapped)).toHaveLength(3)
    expect(contentRefsFromHtml('<a href="cyfs:///home/a.txt">a</a>')).toBeUndefined()
    expect(contentRefsFromHtml('<a href="cyfs:///home/../a.txt" data-buckyos-ref=\'{"v":1,"kind":"file"}\'>a</a>')).toBeUndefined()
    expect(contentRefsFromHtml('<a href="cyfs:///home/a.txt" data-buckyos-ref=\'{"v":2,"kind":"file"}\'>a</a>')).toBeUndefined()
  })
  it('reads in the registered order', () => {
    const mime = transferReader({ types: Object.keys(reps), data: reps, files: [] })
    expect(mime.contentRefs()?.via).toBe('mime')
    const htmlOnly = transferReader({ types: ['text/html', 'text/plain'], data: { 'text/html': reps['text/html'], 'text/plain': reps['text/plain'] }, files: [] })
    expect(htmlOnly.contentRefs()?.via).toBe('html')
    const broken = transferReader({ types: [CONTENT_REFS_FORMAT, 'text/html'], data: { [CONTENT_REFS_FORMAT]: '{"v":9}', 'text/html': reps['text/html'] }, files: [] })
    expect(broken.contentRefs()?.via).toBe('html')
    const text = transferReader({ types: ['text/plain'], data: { 'text/plain': 'cyfs:///home/alice/a.pdf' }, files: [] })
    expect(text.contentRefs()).toBeUndefined()
    expect(text.addresses()).toEqual([{ kind: 'cyfs-path', path: 'cyfs:///home/alice/a.pdf' }])
  })
})

describe('typed table', () => {
  const table: TypedTable = {
    fields: [
      { name: 'Name', type: 'text' }, { name: 'Done', type: 'boolean' }, { name: 'Price', type: 'currency', scale: 2, currency: 'CNY' },
      { name: 'Tags', type: 'multi_select', options: ['a', 'b'] }, { name: 'Due', type: 'date' }, { name: 'Meta', type: 'json' },
    ],
    rows: [
      [{ value: 'Tab\there "q"', text: 'Tab\there "q"' }, { value: true, text: 'Yes' }, { value: { amount: '500.00', currency: 'CNY' }, text: '¥500.00' }, { value: ['a', 'b'], text: 'a, b' }, { value: '2026-11-25', text: 'Nov 25' }, { value: { k: 1 } }],
      [{ value: 'Line\nbreak', text: 'Line\nbreak' }, {}, {}, {}, {}, {}],
    ],
  }
  const reps = typedTableRepresentations(table)
  it('writes a TSV with a header row', () => {
    expect(reps['text/plain']).toBe('Name\tDone\tPrice\tTags\tDue\tMeta\r\n"Tab\there ""q"""\tTRUE\tCNY 500.00\ta, b\t2026-11-25\t"{""k"":1}"\r\n"Line\nbreak"\t\t\t\t\t\r\n')
  })
  it('reads its own HTML back exactly', () => {
    expect(readTypedTable(reps['text/html'])).toEqual({
      fields: table.fields,
      rows: [
        [{ value: 'Tab\there "q"', text: 'Tab here "q"' }, { value: true, text: 'Yes' }, { value: { amount: '500.00', currency: 'CNY' }, text: '¥500.00' }, { value: ['a', 'b'], text: 'a, b' }, { value: '2026-11-25', text: 'Nov 25' }, { value: { k: 1 }, text: '{"k":1}' }],
        [{ value: 'Line\nbreak', text: 'Line\nbreak' }, {}, {}, {}, {}, {}],
      ],
    })
  })
  it('falls back on other versions and damaged marks, and drops values that do not fit', () => {
    expect(readTypedTable(reps['text/html'].replace('{&quot;v&quot;:1', '{&quot;v&quot;:2'))).toBeUndefined()
    expect(readTypedTable('<table data-buckyos-table="{"><tr><td>x</td></tr></table>')).toBeUndefined()
    expect(readTypedTable('<table data-buckyos-table=\'{"v":1,"fields":[{"name":"x","type":"object_ref"}]}\'></table>')).toBeUndefined()
    const t = readTypedTable('<table data-buckyos-table=\'{"v":1,"fields":[{"name":"n","type":"number"}]}\'><tr><td data-buckyos-value=\'"7"\'>7</td></tr></table>')
    expect(t?.rows).toEqual([[{ text: '7' }]])
    expect(readTypedTable('<table><tr><td>plain</td></tr></table>')).toBeUndefined()
  })
})

describe('transfer handle', () => {
  it('round-trips and survives in the HTML', () => {
    const id = newOfferId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(readTransferHandle(transferHandleValue(id))).toEqual({ v: 1, offerId: id })
    expect(readTransferHandle('{"v":1,"offerId":"short"}')).toBeUndefined()
    expect(readTransferHandle(transferHandleValue(id, { cut: true }))).toEqual({ v: 1, offerId: id, cut: true })
    expect(transferHandleFromHtml(embedTransferHandle('<b>x</b>', id, { cut: true }))?.cut).toBe(true)
    expect(readTransferHandle(JSON.stringify({ v: 1, offerId: id, cut: 'yes' }))).toEqual({ v: 1, offerId: id })
    const html = embedTransferHandle('<meta charset="utf-8"><b>x</b>', id)
    expect(transferHandleFromHtml(html)).toEqual({ v: 1, offerId: id })
    expect(transferReader({ types: ['text/html'], data: { 'text/html': html }, files: [] }).handle()?.offerId).toBe(id)
    expect(transferReader({ types: [TRANSFER_HANDLE_FORMAT], data: { [TRANSFER_HANDLE_FORMAT]: transferHandleValue(id) }, files: [] }).handle()?.offerId).toBe(id)
  })
})
