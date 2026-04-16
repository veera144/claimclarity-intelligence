import type { ReactElement } from 'react'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerClient, type Json } from '@claimclarity/db'

type PageProps = {
  searchParams?: Promise<{
    category?: string
    insurer?: string
    verified?: string
  }>
}

type PatternRow = {
  id: string
  insurer_name: string | null
  clause_category: string
  clause_keywords: string[]
  typical_clause_text: string | null
  common_deduction_trigger: string
  operative_reason_template: string
  plain_language_template: string
  appeal_point_template: string
  is_active: boolean | null
  verified_by_expert: boolean | null
}

function toJson(value: unknown): Json {
  return value as Json
}

function parseKeywords(value: FormDataEntryValue | null): string[] {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : []
}

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

async function requireExpertOrAdmin(): Promise<string> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data, error } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (error || (data.role !== 'expert' && data.role !== 'admin')) redirect('/access-denied')
  return user.id
}

async function logKbChange(input: {
  patternId: string
  changedBy: string
  changeType: 'created' | 'updated' | 'verified' | 'deactivated'
  oldValues: unknown
  newValues: unknown
  reason: string
}): Promise<void> {
  const supabase = await createServerClient()
  const { error } = await supabase.from('kb_change_log').insert({
    pattern_id: input.patternId,
    changed_by: input.changedBy,
    change_type: input.changeType,
    old_values: input.oldValues ? toJson(input.oldValues) : null,
    new_values: toJson(input.newValues),
    change_reason: input.reason,
  })

  if (error) throw new Error(error.message)
}

async function createPattern(formData: FormData): Promise<void> {
  'use server'

  const userId = await requireExpertOrAdmin()
  const supabase = await createServerClient()
  const payload = {
    clause_category: formText(formData, 'clause_category') || 'other',
    insurer_name: formText(formData, 'insurer_name') || null,
    clause_keywords: parseKeywords(formData.get('clause_keywords')),
    typical_clause_text: formText(formData, 'typical_clause_text') || null,
    common_deduction_trigger: formText(formData, 'common_deduction_trigger'),
    operative_reason_template: formText(formData, 'operative_reason_template'),
    plain_language_template: formText(formData, 'plain_language_template'),
    appeal_point_template: formText(formData, 'appeal_point_template'),
    added_by: userId,
    is_active: true,
    verified_by_expert: false,
  }

  const { data, error } = await supabase
    .from('kb_clause_patterns')
    .insert(payload)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  await logKbChange({
    patternId: data.id,
    changedBy: userId,
    changeType: 'created',
    oldValues: null,
    newValues: data,
    reason: 'KB admin created pattern',
  })
  revalidatePath('/knowledge-base')
}

async function updatePattern(formData: FormData): Promise<void> {
  'use server'

  const userId = await requireExpertOrAdmin()
  const patternId = formText(formData, 'pattern_id')
  const supabase = await createServerClient()
  const { data: oldValues, error: readError } = await supabase
    .from('kb_clause_patterns')
    .select('*')
    .eq('id', patternId)
    .single()
  if (readError) throw new Error(readError.message)

  const payload = {
    clause_keywords: parseKeywords(formData.get('clause_keywords')),
    typical_clause_text: formText(formData, 'typical_clause_text') || null,
    common_deduction_trigger: formText(formData, 'common_deduction_trigger'),
    operative_reason_template: formText(formData, 'operative_reason_template'),
    plain_language_template: formText(formData, 'plain_language_template'),
    appeal_point_template: formText(formData, 'appeal_point_template'),
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('kb_clause_patterns')
    .update(payload)
    .eq('id', patternId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  await logKbChange({
    patternId,
    changedBy: userId,
    changeType: 'updated',
    oldValues,
    newValues: data,
    reason: 'KB admin updated pattern',
  })
  revalidatePath('/knowledge-base')
}

async function verifyPattern(formData: FormData): Promise<void> {
  'use server'

  const userId = await requireExpertOrAdmin()
  const patternId = formText(formData, 'pattern_id')
  const supabase = await createServerClient()
  const { data: oldValues, error: readError } = await supabase
    .from('kb_clause_patterns')
    .select('*')
    .eq('id', patternId)
    .single()
  if (readError) throw new Error(readError.message)

  const { data, error } = await supabase
    .from('kb_clause_patterns')
    .update({
      verified_by_expert: true,
      verified_by: userId,
      verified_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', patternId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  await logKbChange({
    patternId,
    changedBy: userId,
    changeType: 'verified',
    oldValues,
    newValues: data,
    reason: 'KB admin expert verification',
  })
  revalidatePath('/knowledge-base')
}

async function deactivatePattern(formData: FormData): Promise<void> {
  'use server'

  const userId = await requireExpertOrAdmin()
  const patternId = formText(formData, 'pattern_id')
  const supabase = await createServerClient()
  const { data: oldValues, error: readError } = await supabase
    .from('kb_clause_patterns')
    .select('*')
    .eq('id', patternId)
    .single()
  if (readError) throw new Error(readError.message)

  const { data, error } = await supabase
    .from('kb_clause_patterns')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', patternId)
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  await logKbChange({
    patternId,
    changedBy: userId,
    changeType: 'deactivated',
    oldValues,
    newValues: data,
    reason: 'KB admin deactivated pattern',
  })
  revalidatePath('/knowledge-base')
}

function keywordPreview(pattern: PatternRow): string {
  const joined = pattern.clause_keywords.join(', ')
  return joined.length > 96 ? `${joined.slice(0, 96)}...` : joined
}

export default async function KnowledgeBasePage(props: PageProps): Promise<ReactElement> {
  await requireExpertOrAdmin()
  const searchParams = (await props.searchParams) ?? {}
  const supabase = await createServerClient()
  let query = supabase
    .from('kb_clause_patterns')
    .select(
      'id, insurer_name, clause_category, clause_keywords, typical_clause_text, common_deduction_trigger, operative_reason_template, plain_language_template, appeal_point_template, is_active, verified_by_expert'
    )
    .order('clause_category', { ascending: true })

  if (searchParams.category) query = query.eq('clause_category', searchParams.category)
  if (searchParams.insurer) query = query.ilike('insurer_name', `%${searchParams.insurer}%`)
  if (searchParams.verified === 'true') query = query.eq('verified_by_expert', true)
  if (searchParams.verified === 'false') query = query.eq('verified_by_expert', false)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const patterns = data as PatternRow[]

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm uppercase text-emerald-300">Knowledge base</p>
        <h1 className="mt-3 text-3xl font-semibold">Clause patterns</h1>

        <form className="mt-8 grid gap-3 border-y border-neutral-800 py-5 md:grid-cols-4">
          <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" name="category" placeholder="Category" defaultValue={searchParams.category ?? ''} />
          <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" name="insurer" placeholder="Insurer" defaultValue={searchParams.insurer ?? ''} />
          <select className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" name="verified" defaultValue={searchParams.verified ?? ''}>
            <option value="">Any verification</option>
            <option value="true">Verified</option>
            <option value="false">Unverified</option>
          </select>
          <button className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-neutral-950">
            Filter
          </button>
        </form>

        <form action={createPattern} className="mt-8 grid gap-3 border-b border-neutral-800 pb-8">
          <h2 className="text-xl font-semibold">Add pattern</h2>
          <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="clause_category" placeholder="Category" required />
          <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="insurer_name" placeholder="Insurer, optional" />
          <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="clause_keywords" placeholder="Keywords, comma separated" required />
          <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="common_deduction_trigger" placeholder="Common deduction trigger" required />
          <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="typical_clause_text" placeholder="Typical clause text" />
          <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="operative_reason_template" placeholder="Operative reason template" required />
          <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="plain_language_template" placeholder="Plain language template" required />
          <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" name="appeal_point_template" placeholder="Appeal point template" required />
          <button className="w-fit rounded-lg bg-emerald-300 px-4 py-2 font-semibold text-neutral-950">
            Add pattern
          </button>
        </form>

        <div className="mt-8 overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead className="border-b border-neutral-800 text-neutral-300">
              <tr>
                <th className="py-3 pr-4">Category</th>
                <th className="py-3 pr-4">Insurer</th>
                <th className="py-3 pr-4">Keywords</th>
                <th className="py-3 pr-4">Verified</th>
                <th className="py-3 pr-4">Active</th>
                <th className="py-3 pr-4">Actions</th>
              </tr>
            </thead>
            <tbody>
              {patterns.map((pattern) => (
                <tr className="border-b border-neutral-900 align-top" key={pattern.id}>
                  <td className="py-4 pr-4 font-medium">{pattern.clause_category}</td>
                  <td className="py-4 pr-4">{pattern.insurer_name ?? 'All'}</td>
                  <td className="py-4 pr-4 text-neutral-300">{keywordPreview(pattern)}</td>
                  <td className="py-4 pr-4">{pattern.verified_by_expert ? 'Verified' : 'Unverified'}</td>
                  <td className="py-4 pr-4">{pattern.is_active ? 'Active' : 'Inactive'}</td>
                  <td className="space-y-3 py-4 pr-4">
                    <form action={verifyPattern}>
                      <input name="pattern_id" type="hidden" value={pattern.id} />
                      <button className="rounded-lg border border-emerald-400 px-3 py-2 text-xs text-emerald-200">
                        Mark as Expert-Verified
                      </button>
                    </form>
                    <form action={deactivatePattern}>
                      <input name="pattern_id" type="hidden" value={pattern.id} />
                      <button className="rounded-lg border border-red-400 px-3 py-2 text-xs text-red-200">
                        Deactivate
                      </button>
                    </form>
                    <form action={updatePattern} className="grid gap-2">
                      <input name="pattern_id" type="hidden" value={pattern.id} />
                      <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1" name="clause_keywords" defaultValue={pattern.clause_keywords.join(', ')} />
                      <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1" name="common_deduction_trigger" defaultValue={pattern.common_deduction_trigger} />
                      <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1" name="typical_clause_text" defaultValue={pattern.typical_clause_text ?? ''} />
                      <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1" name="operative_reason_template" defaultValue={pattern.operative_reason_template} />
                      <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1" name="plain_language_template" defaultValue={pattern.plain_language_template} />
                      <textarea className="min-h-16 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1" name="appeal_point_template" defaultValue={pattern.appeal_point_template} />
                      <button className="w-fit rounded-lg border border-neutral-500 px-3 py-2 text-xs">
                        Save edits
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
