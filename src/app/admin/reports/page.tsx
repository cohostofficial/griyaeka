'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format } from 'date-fns'
import { id } from 'date-fns/locale'

interface Attendance {
  id: string
  check_in_time: string
  check_out_time: string | null
  total_hours: number | null
  status: string
  selfie_in_url: string | null
  selfie_out_url: string | null
  users: { name: string }
  locations: { name: string }
}

interface Employee { id: string; name: string }

interface ModalState {
  signedUrl: string
  storagePath: string
  attendanceId: string
  field: 'selfie_in_url' | 'selfie_out_url'
  employeeName: string
  date: string
  type: 'in' | 'out'
}

function toStoragePath(raw: string): string | null {
  if (!raw) return null
  if (!raw.startsWith('http')) return raw
  const m = raw.match(/\/selfies\/(.+?)(\?|$)/)
  return m ? m[1] : null
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function ReportsPage() {
  const supabase = createClient()

  const [attendances, setAttendances] = useState<Attendance[]>([])
  const [employees, setEmployees]     = useState<Employee[]>([])
  const [loading, setLoading]         = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState('')
  const [dateFrom, setDateFrom]       = useState(firstOfMonthStr)
  const [dateTo, setDateTo]           = useState(todayStr)

  const [modal, setModal]                         = useState<ModalState | null>(null)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [deleting, setDeleting]                   = useState(false)
  const [zipping, setZipping]                     = useState(false)
  const [toast, setToast]                         = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    supabase.from('users').select('id,name')
      .eq('role', 'employee').eq('is_active', true)
      .then(({ data }) => { if (data) setEmployees(data) })
  }, [supabase])

  function showToast(ok: boolean, msg: string) {
    setToast({ ok, msg })
    setTimeout(() => setToast(null), 4000)
  }

  async function loadReport() {
    if (!dateFrom || !dateTo) { showToast(false, 'Pilih tanggal dari dan sampai'); return }
    if (dateFrom > dateTo) { showToast(false, 'Tanggal "dari" tidak boleh lebih besar dari "sampai"'); return }

    setLoading(true)
    const from = dateFrom + 'T00:00:00+07:00'
    const to   = dateTo   + 'T23:59:59+07:00'

    let q = supabase
      .from('attendances')
      .select('*, users(name), locations(name)')
      .gte('check_in_time', from)
      .lte('check_in_time', to)
      .order('check_in_time', { ascending: false })

    if (selectedEmployee) q = q.eq('user_id', selectedEmployee)

    const { data } = await q
    if (data) setAttendances(data as Attendance[])
    setLoading(false)
  }

  async function exportExcel() {
    const { utils, writeFile } = await import('xlsx')
    const rows = attendances.map(a => ({
      Nama: a.users.name,
      Tanggal: format(new Date(a.check_in_time), 'd MMM yyyy', { locale: id }),
      'Jam Masuk': format(new Date(a.check_in_time), 'HH:mm'),
      'Jam Pulang': a.check_out_time ? format(new Date(a.check_out_time), 'HH:mm') : '-',
      'Total Jam': a.total_hours?.toFixed(2) ?? '-',
      Lokasi: a.locations.name,
      Status: a.check_in_time ? 'Hadir' : 'Tidak Hadir',
    }))
    const wb = utils.book_new()
    utils.book_append_sheet(wb, utils.json_to_sheet(rows), 'Laporan')
    writeFile(wb, `Laporan_${dateFrom}_sd_${dateTo}.xlsx`)
  }

  async function getSignedUrl(storagePath: string): Promise<string> {
    const { data, error } = await supabase.storage
      .from('selfies').createSignedUrl(storagePath, 3600)
    if (error || !data?.signedUrl) throw new Error('Gagal membuat signed URL')
    return data.signedUrl
  }

  async function openSelfie(att: Attendance, type: 'in' | 'out') {
    const raw = type === 'in' ? att.selfie_in_url : att.selfie_out_url
    if (!raw) return
    const storagePath = toStoragePath(raw)
    if (!storagePath) { showToast(false, 'Path foto tidak valid'); return }

    const field: ModalState['field'] = type === 'in' ? 'selfie_in_url' : 'selfie_out_url'
    setModal({ signedUrl: 'loading', storagePath, attendanceId: att.id, field, employeeName: att.users.name, date: att.check_in_time, type })

    try {
      const url = await getSignedUrl(storagePath)
      setModal(prev => prev ? { ...prev, signedUrl: url } : null)
    } catch {
      showToast(false, 'Gagal memuat foto')
      setModal(null)
    }
  }

  async function downloadOneSelfie() {
    if (!modal || modal.signedUrl === 'loading') return
    try {
      const res  = await fetch(modal.signedUrl)
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `selfie_${modal.type === 'in' ? 'masuk' : 'pulang'}_${modal.employeeName.replace(/\s+/g, '_')}_${format(new Date(modal.date), 'yyyy-MM-dd')}.jpg`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      showToast(false, 'Gagal mengunduh foto')
    }
  }

  async function deleteOneSelfie() {
    if (!modal || !modal.storagePath) return
    if (!confirm(`Hapus foto selfie ${modal.type === 'in' ? 'masuk' : 'pulang'} milik ${modal.employeeName}?\n\nData absensi tetap tersimpan.`)) return

    const res = await fetch('/api/storage/delete-selfies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths: [modal.storagePath],
        dbUpdates: [{ id: modal.attendanceId, fields: { [modal.field]: null } }],
      }),
    })
    const data = await res.json()
    if (!res.ok || data.errors > 0) {
      showToast(false, `Gagal menghapus foto: ${data.error ?? 'Unknown error'}`)
      return
    }
    showToast(true, 'Foto berhasil dihapus dari Supabase Storage')
    setModal(null)
    loadReport()
  }

  async function downloadAllSelfiesZip() {
    const withSelfie = attendances.filter(a => a.selfie_in_url || a.selfie_out_url)
    if (withSelfie.length === 0) { showToast(false, 'Tidak ada foto selfie di periode ini'); return }

    setZipping(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip   = new JSZip()

      for (const att of withSelfie) {
        const dateStr = format(new Date(att.check_in_time), 'yyyy-MM-dd')
        const name    = att.users.name.replace(/\s+/g, '_')

        for (const type of ['in', 'out'] as const) {
          const raw = type === 'in' ? att.selfie_in_url : att.selfie_out_url
          if (!raw) continue
          const path = toStoragePath(raw)
          if (!path) continue
          try {
            const url  = await getSignedUrl(path)
            const res  = await fetch(url)
            const blob = await res.blob()
            zip.file(`selfie_${type === 'in' ? 'masuk' : 'pulang'}_${name}_${dateStr}.jpg`, blob)
          } catch { /* skip */ }
        }
      }

      const content = await zip.generateAsync({ type: 'blob' })
      const url     = URL.createObjectURL(content)
      const a       = document.createElement('a')
      a.href        = url
      a.download    = `Selfie_${dateFrom}_sd_${dateTo}.zip`
      a.click()
      URL.revokeObjectURL(url)
      showToast(true, 'Semua foto berhasil diunduh sebagai ZIP')
    } catch {
      showToast(false, 'Gagal membuat file ZIP')
    } finally {
      setZipping(false)
    }
  }

  async function bulkDeleteSelfies() {
    setDeleting(true)
    const paths: string[] = []
    const dbUpdates: { id: string; fields: Record<string, null> }[] = []

    for (const att of attendances) {
      const fields: Record<string, null> = {}
      if (att.selfie_in_url) {
        const p = toStoragePath(att.selfie_in_url)
        if (p) { paths.push(p); fields.selfie_in_url = null }
      }
      if (att.selfie_out_url) {
        const p = toStoragePath(att.selfie_out_url)
        if (p) { paths.push(p); fields.selfie_out_url = null }
      }
      if (Object.keys(fields).length > 0) dbUpdates.push({ id: att.id, fields })
    }

    const res  = await fetch('/api/storage/delete-selfies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths, dbUpdates }),
    })
    const data = await res.json()
    setDeleting(false)
    setShowBulkDeleteModal(false)

    if (!res.ok) {
      showToast(false, `Gagal: ${data.error ?? 'Unknown error'}`)
    } else {
      showToast(true, `${data.deleted} foto berhasil dihapus${data.errors > 0 ? `, ${data.errors} gagal` : ''}`)
      loadReport()
    }
  }

  const totalHours   = attendances.reduce((s, a) => s + (a.total_hours ?? 0), 0)
  const presentCount = attendances.filter(a => a.check_in_time).length
  const selfieCount  = attendances.reduce((s, a) =>
    s + (a.selfie_in_url ? 1 : 0) + (a.selfie_out_url ? 1 : 0), 0)
  const periodLabel  = `${dateFrom} s/d ${dateTo}`

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Laporan Absensi</h1>
        <p className="text-sm text-gray-500">Filter per rentang tanggal, ekspor, dan kelola foto selfie</p>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-32">
            <label className="block text-xs text-gray-500 font-medium mb-1">Dari Tanggal</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1 min-w-32">
            <label className="block text-xs text-gray-500 font-medium mb-1">Sampai Tanggal</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex-1 min-w-36">
            <label className="block text-xs text-gray-500 font-medium mb-1">Karyawan</label>
            <select value={selectedEmployee} onChange={e => setSelectedEmployee(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Semua Karyawan</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div className="flex items-end flex-wrap gap-2">
            <button onClick={loadReport} disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              {loading ? 'Memuat...' : 'Tampilkan'}
            </button>
            {attendances.length > 0 && (
              <button onClick={exportExcel}
                className="px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700">
                Export Excel
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Kelola selfie */}
      {attendances.length > 0 && selfieCount > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <p className="text-xs text-gray-500 font-medium mb-3">
            Kelola Foto Selfie · <span className="text-gray-700">{selfieCount} foto</span> periode {periodLabel}
          </p>
          <div className="flex flex-wrap gap-3">
            <button onClick={downloadAllSelfiesZip} disabled={zipping}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {zipping ? 'Membuat ZIP...' : `Download Semua (${selfieCount}) → ZIP`}
            </button>
            <button onClick={() => setShowBulkDeleteModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-xl text-sm font-semibold hover:bg-red-600">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Hapus Semua Selfie ({selfieCount})
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2">Download dulu sebelum hapus. Data absensi tidak ikut terhapus.</p>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`rounded-2xl px-4 py-3 flex items-center justify-between text-sm font-medium ${
          toast.ok ? 'bg-green-50 border border-green-200 text-green-800'
                   : 'bg-red-50 border border-red-200 text-red-800'
        }`}>
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} className="ml-4 opacity-60 hover:opacity-100 text-lg leading-none">×</button>
        </div>
      )}

      {/* Summary */}
      {attendances.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Total Hadir', value: presentCount,                color: 'text-green-700' },
            { label: 'Total Jam',   value: `${totalHours.toFixed(1)}j`, color: 'text-blue-700'  },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className={`text-2xl font-bold mt-1 ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Tabel */}
      {attendances.length > 0 && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {['Karyawan','Tanggal','Masuk','Pulang','Jam','Status','Selfie'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {attendances.map(att => (
                  <tr key={att.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{att.users.name}</td>
                    <td className="px-4 py-3 text-gray-600">{format(new Date(att.check_in_time), 'd MMM', { locale: id })}</td>
                    <td className="px-4 py-3 text-gray-600">{format(new Date(att.check_in_time), 'HH:mm')}</td>
                    <td className="px-4 py-3 text-gray-600">{att.check_out_time ? format(new Date(att.check_out_time), 'HH:mm') : '-'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono">{att.total_hours ? att.total_hours.toFixed(1) : '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        att.check_in_time ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {att.check_in_time ? 'Hadir' : 'Tidak Hadir'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {att.selfie_in_url
                          ? <button onClick={() => openSelfie(att, 'in')} className="text-xs text-blue-600 hover:underline font-medium">Masuk</button>
                          : <span className="text-xs text-gray-300">-</span>}
                        {att.selfie_out_url &&
                          <button onClick={() => openSelfie(att, 'out')} className="text-xs text-blue-600 hover:underline font-medium">Pulang</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal selfie */}
      {modal && (
        <div className="fixed inset-0 bg-black/85 flex items-end md:items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm overflow-hidden">
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-700">
              <div>
                <p className="text-white text-sm font-semibold">{modal.employeeName}</p>
                <p className="text-gray-400 text-xs">
                  Selfie {modal.type === 'in' ? 'Masuk' : 'Pulang'} · {format(new Date(modal.date), 'd MMM yyyy', { locale: id })}
                </p>
              </div>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="bg-black aspect-square flex items-center justify-center">
              {modal.signedUrl === 'loading' ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <p className="text-gray-400 text-sm">Memuat foto...</p>
                </div>
              ) : (
                <img src={modal.signedUrl} alt="Selfie" className="w-full h-full object-cover"
                  onError={() => { showToast(false, 'Foto tidak dapat ditampilkan'); setModal(null) }} />
              )}
            </div>
            {modal.signedUrl !== 'loading' && (
              <div className="p-4 flex gap-3">
                <button onClick={downloadOneSelfie}
                  className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download
                </button>
                <button onClick={deleteOneSelfie}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Hapus Foto Ini
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal bulk delete */}
      {showBulkDeleteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-center font-bold text-gray-900 mb-2">Hapus Semua Selfie?</h3>
            <p className="text-center text-sm text-gray-500 mb-1">
              <span className="font-semibold text-gray-800">{selfieCount} foto</span> periode{' '}
              <span className="font-semibold text-gray-800">{periodLabel}</span> akan dihapus permanen.
            </p>
            <p className="text-center text-xs text-gray-400 mb-6">Data absensi tidak ikut terhapus.</p>
            <div className="flex gap-3">
              <button onClick={() => setShowBulkDeleteModal(false)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium disabled:opacity-50">
                Batal
              </button>
              <button onClick={bulkDeleteSelfies} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                {deleting ? 'Menghapus...' : `Ya, Hapus ${selfieCount} Foto`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
