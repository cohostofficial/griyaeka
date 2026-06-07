'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Employee {
  id: string
  name: string
  email: string
  phone: string | null
  is_active: boolean
  created_at: string
  salary_rates: { hourly_rate: number; currency: string }[]
}

type ModalType = 'edit' | 'password' | 'delete' | null

export default function EmployeesPage() {
  const supabase = createClient()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)

  const [modalType, setModalType] = useState<ModalType>(null)
  const [targetEmp, setTargetEmp] = useState<Employee | null>(null)

  const [form, setForm] = useState({ name: '', email: '', password: '', phone: '', hourly_rate: '' })
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

  async function load() {
    const { data } = await supabase
      .from('users')
      .select('*, salary_rates(hourly_rate, currency)')
      .eq('role', 'employee')
      .order('created_at', { ascending: false })
    if (data) setEmployees(data as Employee[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function showToast(ok: boolean, msg: string) {
    setToast({ ok, msg })
    setTimeout(() => setToast(null), 4000)
  }

  function closeModal() {
    setModalType(null)
    setTargetEmp(null)
    setError('')
    setNewPassword('')
    setConfirmPassword('')
  }

  function openAdd() {
    setTargetEmp(null)
    setForm({ name: '', email: '', password: '', phone: '', hourly_rate: '' })
    setError('')
    setModalType('edit')
  }

  function openEdit(emp: Employee) {
    setTargetEmp(emp)
    setForm({
      name: emp.name,
      email: emp.email,
      password: '',
      phone: emp.phone ?? '',
      hourly_rate: emp.salary_rates?.[0]?.hourly_rate?.toString() ?? '',
    })
    setError('')
    setModalType('edit')
  }

  function openPassword(emp: Employee) {
    setTargetEmp(emp)
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setModalType('password')
  }

  function openDelete(emp: Employee) {
    setTargetEmp(emp)
    setError('')
    setModalType('delete')
  }

  // ── Simpan tambah / edit ──────────────────────────────────
  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      if (!targetEmp) {
        // Tambah karyawan baru
        if (!form.name || !form.email || !form.password)
          throw new Error('Nama, email, dan password wajib diisi')

        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...form, role: 'employee' }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Gagal membuat karyawan')
        showToast(true, `Karyawan ${form.name} berhasil ditambahkan`)
      } else {
        // ── Update profil di tabel users ──
        const { error: updateErr } = await supabase
          .from('users')
          .update({
            name: form.name,
            phone: form.phone || null,
            email: form.email,
          })
          .eq('id', targetEmp.id)
        if (updateErr) throw updateErr

        // ── Update email di Supabase Auth jika berubah ──
        if (form.email !== targetEmp.email) {
          const res = await fetch('/api/users', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: targetEmp.id, email: form.email }),
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data.error ?? 'Gagal update email login')
        }

        // ── Update tarif per jam: cek dulu ada atau tidak ──
        if (form.hourly_rate) {
          const { data: existing } = await supabase
            .from('salary_rates')
            .select('id')
            .eq('user_id', targetEmp.id)
            .maybeSingle()

          if (existing) {
            await supabase
              .from('salary_rates')
              .update({
                hourly_rate: parseFloat(form.hourly_rate),
                effective_from: new Date().toISOString().split('T')[0],
              })
              .eq('user_id', targetEmp.id)
          } else {
            await supabase
              .from('salary_rates')
              .insert({
                user_id: targetEmp.id,
                hourly_rate: parseFloat(form.hourly_rate),
                currency: 'IDR',
                effective_from: new Date().toISOString().split('T')[0],
              })
          }
        }

        showToast(true, `Data ${form.name} berhasil diperbarui`)
      }
      closeModal()
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }

  // ── Ubah password ─────────────────────────────────────────
  async function handleChangePassword() {
    if (!newPassword) { setError('Password baru wajib diisi'); return }
    if (newPassword.length < 6) { setError('Password minimal 6 karakter'); return }
    if (newPassword !== confirmPassword) { setError('Konfirmasi password tidak cocok'); return }

    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetEmp!.id, password: newPassword }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Gagal mengubah password')
      showToast(true, `Password ${targetEmp!.name} berhasil diubah`)
      closeModal()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }

  // ── Hapus karyawan ────────────────────────────────────────
  async function handleDelete() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetEmp!.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Gagal menghapus karyawan')
      showToast(true, `Karyawan ${targetEmp!.name} berhasil dihapus`)
      closeModal()
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }

  // ── Aktif / nonaktif ──────────────────────────────────────
  async function toggleActive(emp: Employee) {
    await supabase.from('users').update({ is_active: !emp.is_active }).eq('id', emp.id)
    showToast(true, `${emp.name} berhasil ${emp.is_active ? 'dinonaktifkan' : 'diaktifkan'}`)
    load()
  }

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Karyawan</h1>
          <p className="text-sm text-gray-500">Kelola data karyawan</p>
        </div>
        <button onClick={openAdd}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700">
          + Tambah
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`rounded-2xl px-4 py-3 flex items-center justify-between text-sm font-medium ${
          toast.ok
            ? 'bg-green-50 border border-green-200 text-green-800'
            : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-4 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}

      {/* Tabel */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Memuat data...</div>
        ) : employees.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Belum ada karyawan</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Nama</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Email</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Tarif/Jam</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Status</th>
                  <th className="text-left px-5 py-3 text-xs text-gray-500 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {employees.map(emp => (
                  <tr key={emp.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{emp.name}</td>
                    <td className="px-5 py-3 text-gray-600 text-xs">{emp.email}</td>
                    <td className="px-5 py-3 text-gray-600">
                      {emp.salary_rates?.[0]
                        ? `Rp ${Number(emp.salary_rates[0].hourly_rate).toLocaleString('id-ID')}`
                        : '-'}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        emp.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-500'
                      }`}>
                        {emp.is_active ? 'Aktif' : 'Nonaktif'}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-2 flex-wrap">
                        <button onClick={() => openEdit(emp)}
                          className="text-blue-600 hover:underline text-xs font-medium">
                          Edit
                        </button>
                        <button onClick={() => openPassword(emp)}
                          className="text-amber-600 hover:underline text-xs font-medium">
                          Ubah Password
                        </button>
                        <button onClick={() => toggleActive(emp)}
                          className="text-gray-500 hover:underline text-xs font-medium">
                          {emp.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                        <button onClick={() => openDelete(emp)}
                          className="text-red-500 hover:underline text-xs font-medium">
                          Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal Edit / Tambah ── */}
      {modalType === 'edit' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">
                {targetEmp ? 'Edit Karyawan' : 'Tambah Karyawan'}
              </h2>
            </div>
            <div className="p-6 space-y-4">
              {[
                { key: 'name',        label: 'Nama Lengkap',      type: 'text'     },
                { key: 'email',       label: 'Email',             type: 'email'    },
                { key: 'phone',       label: 'No. HP',            type: 'text'     },
                { key: 'hourly_rate', label: 'Tarif per Jam (Rp)',type: 'number'   },
                ...(!targetEmp
                  ? [{ key: 'password', label: 'Password', type: 'password' }]
                  : []),
              ].map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
                  <input
                    type={type}
                    value={form[key as keyof typeof form]}
                    onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={key === 'hourly_rate' ? '25000' : ''}
                  />
                </div>
              ))}
              {error && <p className="text-red-600 text-sm">{error}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={closeModal}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium">
                Batal
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Ubah Password ── */}
      {modalType === 'password' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">Ubah Password</h2>
              <p className="text-sm text-gray-500 mt-0.5">{targetEmp?.name}</p>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Password Baru</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Minimal 6 karakter"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Konfirmasi Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ulangi password baru"
                />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={closeModal}
                className="flex-1 py-2 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium">
                Batal
              </button>
              <button onClick={handleChangePassword} disabled={saving}
                className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold disabled:opacity-50">
                {saving ? 'Menyimpan...' : 'Ubah Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Hapus ── */}
      {modalType === 'delete' && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            <h3 className="text-center font-bold text-gray-900 mb-2">Hapus Karyawan?</h3>
            <p className="text-center text-sm text-gray-500 mb-1">
              <span className="font-semibold text-gray-800">{targetEmp?.name}</span> akan dihapus permanen.
            </p>
            <p className="text-center text-xs text-gray-400 mb-6">
              Semua data absensi dan penggajian karyawan ini ikut terhapus dan tidak bisa dikembalikan.
            </p>
            {error && <p className="text-red-600 text-sm text-center mb-4">{error}</p>}
            <div className="flex gap-3">
              <button onClick={closeModal} disabled={saving}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium disabled:opacity-50">
                Batal
              </button>
              <button onClick={handleDelete} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50">
                {saving ? 'Menghapus...' : 'Ya, Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
