import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// ── Helper: pastikan requester adalah admin ──────────────────
async function requireAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') return null
  return user
}

// ── POST: tambah karyawan baru ───────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { name, email, password, phone, role, hourly_rate } = await req.json()
    if (!name || !email || !password)
      return NextResponse.json({ error: 'Nama, email, dan password wajib diisi' }, { status: 400 })

    const adminClient = createAdminClient()

    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const { error: profileError } = await adminClient.from('users').insert({
      id: authData.user.id,
      name,
      email,
      phone: phone || null,
      role: role ?? 'employee',
    })
    if (profileError) {
      await adminClient.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    if (hourly_rate) {
      await adminClient.from('salary_rates').insert({
        user_id: authData.user.id,
        hourly_rate: parseFloat(hourly_rate),
        currency: 'IDR',
        effective_from: new Date().toISOString().split('T')[0],
      })
    }

    return NextResponse.json({ success: true, user_id: authData.user.id })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// ── PATCH: ubah password dan/atau email di Supabase Auth ─────
export async function PATCH(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { user_id, password, email } = await req.json()
    if (!user_id)
      return NextResponse.json({ error: 'user_id wajib diisi' }, { status: 400 })

    const updatePayload: { password?: string; email?: string } = {}

    if (password) {
      if (password.length < 6)
        return NextResponse.json({ error: 'Password minimal 6 karakter' }, { status: 400 })
      updatePayload.password = password
    }

    if (email) {
      updatePayload.email = email
    }

    if (Object.keys(updatePayload).length === 0)
      return NextResponse.json({ error: 'Tidak ada data yang diubah' }, { status: 400 })

    const adminClient = createAdminClient()
    const { error } = await adminClient.auth.admin.updateUserById(user_id, updatePayload)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

// ── DELETE: hapus karyawan permanen ─────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const admin = await requireAdmin()
    if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { user_id } = await req.json()
    if (!user_id)
      return NextResponse.json({ error: 'user_id wajib diisi' }, { status: 400 })

    const adminClient = createAdminClient()

    // Hapus data terkait berurutan
    await adminClient.from('salary_rates').delete().eq('user_id', user_id)
    await adminClient.from('employee_shifts').delete().eq('user_id', user_id)
    await adminClient.from('payroll_summary').delete().eq('user_id', user_id)
    await adminClient.from('attendances').delete().eq('user_id', user_id)
    await adminClient.from('users').delete().eq('id', user_id)

    // Hapus dari Supabase Auth
    const { error } = await adminClient.auth.admin.deleteUser(user_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
