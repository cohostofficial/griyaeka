import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  try {
    // Pastikan yang request adalah admin
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: profile } = await supabase
      .from('users').select('role').eq('id', user.id).single()
    if (profile?.role !== 'admin')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await req.json()
    const paths: string[] = body.paths ?? []
    const dbUpdates: { id: string; fields: Record<string, null> }[] = body.dbUpdates ?? []

    if (paths.length === 0)
      return NextResponse.json({ error: 'Tidak ada path yang diberikan' }, { status: 400 })

    // Gunakan service_role → bisa hapus file milik siapa saja
    const admin = createAdminClient()

    // Hapus dari Storage dalam batch 20
    let deleted = 0
    let errors = 0
    for (let i = 0; i < paths.length; i += 20) {
      const batch = paths.slice(i, i + 20)
      const { error } = await admin.storage.from('selfies').remove(batch)
      if (error) {
        console.error('Storage delete error:', error.message)
        errors += batch.length
      } else {
        deleted += batch.length
      }
    }

    // Kosongkan kolom selfie_in_url / selfie_out_url di database
    for (const upd of dbUpdates) {
      const { error } = await admin
        .from('attendances')
        .update(upd.fields)
        .eq('id', upd.id)
      if (error) console.error('DB update error:', error.message)
    }

    return NextResponse.json({ deleted, errors })
  } catch (err: unknown) {
    console.error('delete-selfies error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
