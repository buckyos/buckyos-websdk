import { AiwsFailure, AiWorkspaceClient } from '../src/aiworkspace_client'
import {
  cellValue, commitOps, fieldAdd, markdownToBlocks, move, optionAdd, rename, setProps, tableDelete, tableInsert, tableSet,
  textAppend, textDeleteBlocks, textReplaceBlock, type AiwsTableRead,
} from '../src/aiws_write'
import { AIWS_PROTOCOL_VERSION } from '../src/aiws_schedule'

// a table as doc.read answers it (envelope + content.fields)
const sales: AiwsTableRead = {
  entity_id: 'sales',
  content: {
    fields: [
      { field_id: 'f_customer', name: '客户', type: 'text', order_key: 'a', def_rev: 3 },
      { field_id: 'f_amount', name: '金额', type: 'decimal', order_key: 'b', def_rev: 3 },
      { field_id: 'f_qty', name: 'Qty', type: 'number', order_key: 'c', def_rev: 3 },
      { field_id: 'f_state', name: '状态', type: 'select', order_key: 'd', def_rev: 7, options: [{ option_id: 'open', label: '进行中' }, { option_id: 'won', label: '已完成' }] },
      { field_id: 'f_tags', name: 'Tags', type: 'multi_select', order_key: 'e', def_rev: 3, options: [{ option_id: 't1', label: 'A' }, { option_id: 't2', label: 'B' }] },
      { field_id: 'f_paid', name: 'Paid', type: 'boolean', order_key: 'f', def_rev: 3 },
      { field_id: 'f_price', name: 'Price', type: 'currency', order_key: 'g', def_rev: 3, currency: 'CNY' },
      { field_id: 'f_owner', name: 'Owner', type: 'object_ref', order_key: 'h', def_rev: 3 },
    ],
  },
}

const codeOf = (run: () => unknown): string | undefined => {
  try { run() } catch (error) { return (error as AiwsFailure).code }
  return undefined
}

describe('table helpers', () => {
  it('turn field names into ids and labels into option ids, normalizing by type', () => {
    const [op] = tableInsert(sales, [
      { _id: 'r1', 客户: 'ACME', 金额: 12.5, Qty: '3', 状态: '已完成', Tags: 'A; B', Paid: 'true', Price: 'USD 12.50', Owner: '~alice' },
      { 客户: 'Beta', 状态: 'open', Tags: '["B"]', Paid: 0, 金额: null },
    ], { newRecordId: () => 'gen' })
    expect(op).toEqual({ op: 'table.insert_records', source_id: 'sales', records: [
      { record_id: 'r1', values: { f_customer: 'ACME', f_amount: '12.5', f_qty: 3, f_state: 'won', f_tags: ['t1', 't2'], f_paid: true, f_price: { amount: '12.50', currency: 'USD' }, f_owner: { entity_id: 'alice' } } },
      { record_id: 'gen', values: { f_customer: 'Beta', f_state: 'open', f_tags: ['t2'], f_paid: false } },
    ] })
    // a field id names a field too
    expect((tableInsert(sales, [{ f_customer: 'X' }], { newRecordId: () => 'g' })[0].records as unknown[])[0]).toEqual({ record_id: 'g', values: { f_customer: 'X' } })
    expect(codeOf(() => tableInsert(sales, [{ Nope: 1 }]))).toBe('INVALID_SCHEMA')
    expect(codeOf(() => tableInsert(sales, [{ 状态: 'missing' }]))).toBe('INVALID_SCHEMA')
    expect(codeOf(() => tableInsert(sales, [{ Qty: 'many' }]))).toBe('INVALID_SCHEMA')
    expect(codeOf(() => cellValue({ field_id: 'o', name: 'o', type: 'object_ref' }, '/data/x'))).toBe('INVALID_SCHEMA')
    expect(cellValue({ field_id: 'p', name: 'p', type: 'currency' }, '9.90 EUR')).toEqual({ amount: '9.90', currency: 'EUR' })
    expect(cellValue({ field_id: 'j', name: 'j', type: 'json' }, '{"a":1}')).toEqual({ a: 1 })
    expect(cellValue({ field_id: 'n', name: 'n', type: 'number' }, { $formula: 'x' })).toEqual({ $formula: 'x' })
  })

  it('fill every cell expect from the record as read, and unset what null clears', () => {
    const read = { entity_id: 'sales', content: { record_id: 'r1', rev: 9, revs: { f_state: 4, f_customer: 2 }, values: { f_state: 'open', f_customer: 'ACME' } } }
    expect(tableSet(sales, 'r1', { 状态: '已完成', Qty: 2, 客户: null }, read)).toEqual([
      { op: 'table.set_values', source_id: 'sales', values: [
        { record_id: 'r1', field_id: 'f_state', expect: { rev: 4 }, value: 'won' },
        { record_id: 'r1', field_id: 'f_qty', expect: { rev: 0 }, value: 2 },
      ] },
      { op: 'table.unset_values', source_id: 'sales', values: [{ record_id: 'r1', field_id: 'f_customer', expect: { rev: 2 } }] },
    ])
    // the SQL `_record` column works as the read
    expect(tableSet(sales, 'r1', { Qty: 1 }, JSON.stringify(read.content))[0].values).toEqual([{ record_id: 'r1', field_id: 'f_qty', expect: { rev: 0 }, value: 1 }])
    expect(codeOf(() => tableSet(sales, 'r2', { Qty: 1 }, read))).toBe('INVALID_OPERATION')
    expect(tableDelete('sales', ['r1'], [read])).toEqual([{ op: 'table.delete_records', source_id: 'sales', records: [{ record_id: 'r1', expect: { rev: 9 } }] }])
    expect(codeOf(() => tableDelete(sales, ['r1', 'r2'], [read]))).toBe('NOT_FOUND')
  })

  it('add a field after the last one with generated ids, and an option at the field def_rev', () => {
    const op = fieldAdd(sales, { name: 'Stage', type: 'select', options: ['Lead', '成交'] }, { backfill: 'Lead' })
    const field = op.field as { field_id: string; name: string; type: string; options: { option_id: string; label: string }[] }
    expect([op.op, op.source_id, field.name, field.type, field.options.map((o) => o.label)]).toEqual(['table.add_field', 'sales', 'Stage', 'select', ['Lead', '成交']])
    expect(field.field_id).toMatch(/^stage_[0-9a-z]{6}$/)
    expect(field.options[0].option_id).toMatch(/^lead_[0-9a-z]{6}$/)
    expect(field.options[1].option_id).toMatch(/^o[0-9a-z]{6}$/)
    expect((op.order_key as string) > 'h').toBe(true)
    expect(op.backfill).toBe(field.options[0].option_id)
    const opt = optionAdd(sales, '状态', '已取消', { option_id: 'lost' })
    expect(opt).toEqual({ op: 'table.add_option', source_id: 'sales', field_id: 'f_state', option: { option_id: 'lost', label: '已取消' }, expect: { rev: 7 } })
    expect(codeOf(() => optionAdd(sales, '状态', '进行中'))).toBe('INVALID_OPERATION')
    expect(codeOf(() => optionAdd(sales, 'Qty', 'x'))).toBe('INVALID_OPERATION')
  })
})

describe('rich text and common property helpers', () => {
  const doc = { entity_id: 'notes', content: { blocks: { b1: { hash: 'h1', struct_rev: 5 }, b2: { hash: 'h2', struct_rev: 6 } } } }

  it('append, replace and delete blocks with the expect of what was read', () => {
    const [append] = textAppend(doc, '# Plan\n\nfirst', { prefix: 'n1' })
    expect(append).toEqual({ op: 'richtext.insert_blocks', entity_id: 'notes', position: { end: true }, blocks: [
      { type: 'heading', attrs: { block_id: 'n1-1' }, content: [{ type: 'text', text: 'Plan' }] },
      { type: 'paragraph', attrs: { block_id: 'n1-2' }, content: [{ type: 'text', text: 'first' }] },
    ] })
    const replaced = textReplaceBlock(doc, 'b1', 'new **text**\n\nand more', undefined, { prefix: 'r' })
    expect(replaced).toEqual([
      { op: 'richtext.replace_block', entity_id: 'notes', block_id: 'b1', expect: { hash: 'h1' }, node: { type: 'paragraph', attrs: { block_id: 'b1' }, content: [{ type: 'text', text: 'new ' }, { type: 'text', text: 'text', marks: [{ type: 'strong' }] }] } },
      { op: 'richtext.insert_blocks', entity_id: 'notes', position: { after: 'b1' }, blocks: [{ type: 'paragraph', attrs: { block_id: 'r-2' }, content: [{ type: 'text', text: 'and more' }] }] },
    ])
    // a block read wins over the document's index
    expect(textReplaceBlock(doc, 'b1', 'x', { content: { block_id: 'b1', hash: 'h9', struct_rev: 8 } })[0].expect).toEqual({ hash: 'h9' })
    expect(textDeleteBlocks(doc, ['b1', 'b2'])).toEqual([{ op: 'richtext.delete_blocks', entity_id: 'notes', blocks: [
      { block_id: 'b1', expect: { hash: 'h1', struct_rev: 5 } }, { block_id: 'b2', expect: { hash: 'h2', struct_rev: 6 } },
    ] }])
    expect(codeOf(() => textDeleteBlocks(doc, ['b3']))).toBe('NOT_FOUND')
  })

  it('rename, move and set properties expected at the revs read', () => {
    expect(rename({ entity_id: 'sales', meta_rev: 12 }, '销售 2026')).toEqual({ op: 'entity.rename', entity_id: 'sales', name: '销售 2026', expect: { rev: 12 } })
    expect(rename({ entity_id: 'sales', version: { meta_rev: 3 } }, null)).toEqual({ op: 'entity.rename', entity_id: 'sales', name: null, expect: { rev: 3 } })
    expect(codeOf(() => rename({ entity_id: 'sales' }, 'x'))).toBe('INVALID_OPERATION')
    const moved = move({ entity_id: 'sales', struct_rev: 4 }, 'archive', 'k')
    expect([moved.new_parent_id, moved.expect, (moved.order_key as string) > 'k']).toEqual(['archive', { rev: 4 }, true])
    expect(move('sales', 'archive')).toEqual({ op: 'tree.move', entity_id: 'sales', new_parent_id: 'archive', order_key: 'i' })
    const cell = { entity_id: 'blk', content: { key_revs: { config: 9, 'p:config.title': 7 } } }
    expect(setProps(cell, 'config', { title: 'Q4', color: null })).toEqual({ op: 'entity.set_props', entity_id: 'blk', key: 'config', props: { title: 'Q4', color: null }, expect: { title: 7, color: 0 } })
    expect(setProps('blk', 'on', { clicked: [] })).toEqual({ op: 'entity.set_props', entity_id: 'blk', key: 'on', props: { clicked: [] } })
  })
})

describe('Markdown to rich text blocks', () => {
  it('keeps the structure of the core converter’s sample', () => {
    // i18n-exempt: the sample of aiworkspace core/src/markdown.rs
    const md = '# 季度解读\n\n本季度销售额 **1,234.5**，环比 *+12%*，见 [月度汇总](result:monthly)。\n\n- 华东 `52%`\n- 华南\n  1. 深圳\n  2. 广州\n\n> 注意：已排除未结算订单\n\n```js\nconst a = 1\nconst b = 2\n```\n\n| 月份 | 销售额 |\n| --- | ---: |\n| 7 | 100 |\n\n---\n\n- [x] 已核对\n\n~~旧口径~~ [官网](https://example.com) [坏链接](javascript:alert(1))\n'
    const blocks = markdownToBlocks(md, 'c1')
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'bullet_list', 'blockquote', 'code_block', 'table', 'horizontal_rule', 'bullet_list', 'paragraph'])
    expect(blocks[1].content).toContainEqual({ type: 'text', text: '1,234.5', marks: [{ type: 'strong' }] })
    expect(blocks[4]).toEqual({ type: 'code_block', attrs: { block_id: 'c1-15', language: 'js' }, content: [{ type: 'text', text: 'const a = 1\nconst b = 2' }] })
    expect(blocks[5].content![0].content![0].attrs).toEqual({ header: 1 })
    const item = blocks[2].content![1]
    expect(item.content!.map((n) => n.type)).toEqual(['paragraph', 'ordered_list'])
    const last = JSON.stringify(blocks[8])
    expect(last.includes('https://example.com') && !last.includes('javascript:') && last.includes('坏链接')).toBe(true)
    expect(JSON.stringify(blocks[7])).toContain('☑ 已核对')
    // every block id is unique
    const ids = JSON.stringify(blocks).match(/"block_id":"[^"]+"/g)!
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('inline marks, breaks, object links and degenerate inputs', () => {
    const [p] = markdownToBlocks('***x*** a_b_c _em_ line  \nnext [Sales](entity:sales)', 'p')
    expect(p.content).toEqual([
      { type: 'text', text: 'x', marks: [{ type: 'strong' }, { type: 'em' }] },
      { type: 'text', text: ' a_b_c ' },
      { type: 'text', text: 'em', marks: [{ type: 'em' }] },
      { type: 'text', text: ' line' },
      { type: 'hard_break' },
      { type: 'text', text: 'next ' },
      { type: 'object_link', attrs: { ref: { entity_id: 'sales' }, label: 'Sales' } },
    ])
    expect(markdownToBlocks('Title\n---', 'h')).toEqual([{ type: 'heading', attrs: { block_id: 'h-1', level: 2 }, content: [{ type: 'text', text: 'Title' }] }])
    for (const md of ['', '   \n', '- ', '> ', '1. a\n\n   ```\n   code\n   ```\n', '####### h7', '| a |\n|---|\n']) {
      const blocks = markdownToBlocks(md, 'x')
      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks.every((b) => typeof b.attrs?.block_id === 'string')).toBe(true)
    }
    expect(markdownToBlocks('- ', 'x')[0].content![0].content![0]).toEqual({ type: 'paragraph', attrs: { block_id: 'x-3' } })
  })
})

describe('commitOps', () => {
  type Call = { method: string; params: Record<string, unknown> }
  function transport(answer: (call: Call, n: number) => unknown) {
    const calls: Call[] = []
    return {
      calls,
      client: {
        call: async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
          calls.push({ method, params })
          const out = answer({ method, params }, calls.length)
          if (out instanceof Error) throw out
          return out as T
        },
      },
    }
  }
  const ops = [{ op: 'entity.rename', entity_id: 'a', name: 'b', expect: { rev: 1 } }]
  const info = { ok: true, epoch: 'ep_x' }

  it('takes the epoch, sends one request with an idempotency key and answers the accepted result', async () => {
    const { calls, client } = transport((c) => (c.method === 'ws.get_info' ? info : { status: 'accepted', commit_id: 'cm1', seq: 7 }))
    const result = await commitOps(client, 'ws_1', ops, { message: 'rename a' })
    expect(result).toEqual({ status: 'accepted', commit_id: 'cm1', seq: 7 })
    expect(calls.map((c) => c.method)).toEqual(['ws.get_info', 'doc.commit'])
    expect(calls[1].params).toMatchObject({ protocol_version: AIWS_PROTOCOL_VERSION, workspace_id: 'ws_1', epoch: 'ep_x', message: 'rename a', operations: ops })
    expect(AIWS_PROTOCOL_VERSION).toBe('1.2')
    expect(calls[1].params.idempotency_key).toMatch(/^aiws-k/)
  })

  it('throws a conflict with the conflicting cells, and a refusal with its code, without resending', async () => {
    const conflicts = [{ entity_id: 'sales', selector: { kind: 'table_cell', record_id: 'r1', field_id: 'f' }, expected: { rev: 1 }, current: 3 }]
    const c1 = transport(() => ({ status: 'conflict', code: 'REVISION_CONFLICT', conflicts }))
    const conflict = await commitOps(c1.client, 'ws_1', ops, { epoch: 'ep_x' }).catch((e: AiwsFailure) => e)
    expect([conflict.code, conflict.data]).toEqual(['REVISION_CONFLICT', { conflicts }])
    expect(c1.calls).toHaveLength(1)
    const c2 = transport(() => ({ status: 'rejected', code: 'INVALID_OPERATION', sub_code: 'NAME_CONFLICT', errors: [{ code: 'INVALID_OPERATION', detail: 'name "b" already used' }] }))
    const refused = await commitOps(c2.client, 'ws_1', ops, { epoch: 'ep_x' }).catch((e: AiwsFailure) => e)
    expect([refused.code, refused.subCode, refused.message]).toEqual(['INVALID_OPERATION', 'NAME_CONFLICT', 'INVALID_OPERATION/NAME_CONFLICT: name "b" already used'])
    expect(c2.calls).toHaveLength(1)
    await expect(commitOps(c2.client, 'ws_1', [], { epoch: 'ep_x' })).rejects.toBeInstanceOf(AiwsFailure)
  })

  it('looks an unknown result up and finds it accepted', async () => {
    const { calls, client } = transport((c) => {
      if (c.method === 'doc.commit') return new Error('timeout')
      return { ok: true, status: 'accepted', result: { status: 'accepted', commit_id: 'cm2', seq: 9 } }
    })
    const result = await commitOps(client, 'ws_1', ops, { epoch: 'ep_x', idempotencyKey: 'key-1', retryDelayMs: 0 })
    expect(result.commit_id).toBe('cm2')
    expect(calls.map((c) => c.method)).toEqual(['doc.commit', 'doc.get_submission'])
    expect(calls[1].params).toEqual({ workspace_id: 'ws_1', epoch: 'ep_x', idempotency_key: 'key-1' })
  })

  it('resends with the same key when the service has not seen it, and gives up after the attempts', async () => {
    const { calls, client } = transport((c, n) => {
      if (c.method === 'doc.get_submission') return { ok: true, status: 'not_found' }
      return n === 1 ? new Error('network down') : { status: 'accepted', commit_id: 'cm3', seq: 10 }
    })
    expect((await commitOps(client, 'ws_1', ops, { epoch: 'ep_x', retryDelayMs: 0 })).commit_id).toBe('cm3')
    expect(calls.map((c) => c.method)).toEqual(['doc.commit', 'doc.get_submission', 'doc.commit'])
    expect(calls[2].params.idempotency_key).toBe(calls[0].params.idempotency_key)

    const down = transport((c) => (c.method === 'doc.get_submission' ? new Error('still down') : new Error('network down')))
    await expect(commitOps(down.client, 'ws_1', ops, { epoch: 'ep_x', retryDelayMs: 0, attempts: 2 })).rejects.toThrow('network down')
    expect(down.calls.map((c) => c.method)).toEqual(['doc.commit', 'doc.get_submission', 'doc.commit'])
  })

  it('works over an AiWorkspaceClient (a business failure is not an unknown result)', async () => {
    const { calls, client } = transport((c) => (c.method === 'ws.get_info' ? { ok: false, error: { code: 'NOT_FOUND', retryable: false, detail: 'no such workspace' } } : { status: 'accepted' }))
    const aiws = new AiWorkspaceClient(client as never)
    await expect(commitOps(aiws, 'ws_1', ops)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(calls).toHaveLength(1)
  })
})
