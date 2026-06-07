'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Location {
  id: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  radius_meter: number
  is_active: boolean
}

const emptyForm = { name: '', address: '', latitude: '', longitude: '', radius_meter: '100' }

export default function LocationsPage() {
  const supabase = createClient()
  const [locations, setLocations] = useState<Location[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editTarget, setEditTarget] = useState<Location | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [gettingGps, setGettingGps] = useState(false)

  async function load() {
    const { data } = await supabase.from('locations').select('*').order('created_at', { ascending: false })
    if (data) setLocations(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function openAdd() {
    setEditTarget(null)
    setForm(emptyForm)
    setError('')
    setShowModal(true)
  }

  function openEdit(loc: Location) {
    setEditTarget(loc)
    setForm({
      name: loc.name,
      address: loc.address ?? '',
      latitude: loc.latitude.toString(),
      longitude: loc.longitude.toString(),
      radius_meter: loc.radius_meter.toString(),
    })
    setError('')
    setShowModal(true)
  }

  async function useCurrentGPS() {
    setGettingGps(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true })
      )
      setForm(f => ({
        ...f,
        latitude: pos.coords.latitude.toFixed(7),
        longitude: pos.coords.longitude.toFixed(7),
      }))
    } catch {
      setError('Gagal mendapatkan GPS')
    } finally {
      setGettingGps(false)
    }
  }

  async function handleSave() {
    if (!form.name || !form.latitude || !form.longitude) {
      setError('Nama, latitude, dan longitude wajib diisi')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name,
        address: form.address || null,
        latitude: parseFloat(form.latitude),
        longitude: parseFloat(form.longitude),
        radius_meter: parseInt(form.radius_meter) || 100,
      }
      if (editTarget) {
        const { error: err } = await supabase.from('locations').update(payload).eq('id', editTarget.id)
        if (err) throw err
      } else {
        const { error: err } = await supabase.from('locations').insert(payload)
        if (err) throw err
      }
      setShowModal(false)
      load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(loc: Location) {
    await supabase.from('locations').update({ is_active: !loc.is_active }).eq('id', loc.id)
    load()
  }

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Lokasi Kerja</h1>
          <p className="text-sm text-gray-500">Kelola lokasi absensi yang diizinkan</p>
        </div>
        <button onClick={openAdd}
          className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-blue-700">
          + Tambah
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Memuat data...</div>
        ) : locations.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">Belum ada lokasi</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {locations.map(loc => (
              <div key={loc.id} className="px-6 py-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900 text-sm">{loc.name}</p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      loc.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {loc.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  {loc.address && <p className="text-xs text-gray-500 mt-0.5">{loc.address}</p>}
                  <p className="text-xs text-gray-400 mt-1 font-mono">
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)} · radius {loc.radius_meter}m
                  </p>
                </div>
                <div className="flex gap-3 flex-shrink-0">
                  <button onClick={() => openEdit(loc)}
                    className="text-blue-600 hover:underline text-xs font-medium">Edit</button>
                  <button onClick={() => toggleActive(loc)}
                    className="text-gray-500 hover:underline text-xs font-medium">
                    {loc.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">{editTarget ? 'Edit Lokasi' : 'Tambah Lokasi'}</h2>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nama Lokasi</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Kantor Pusat" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Alamat (opsional)</label>
                <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Jl. Sudirman No. 1, Jakarta" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Latitude</label>
                  <input value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="-6.2088" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Longitude</label>
                  <input value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    placeholder="106.8456" />
                </div>
              </div>
              <button onClick={useCurrentGPS} disabled={gettingGps}
                className="w-full py-2 border border-blue-200 text-blue-600 rounded-xl text-sm font-medium hover:bg-blue-50 disabled:opacity-50">
                {gettingGps ? 'Mengambil GPS...' : 'Gunakan Lokasi Saya Sekarang'}
              </button>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Radius Toleransi (meter)</label>
                <input type="number" value={form.radius_meter} onChange={e => setForm(f => ({ ...f, radius_meter: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="100" />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
              <button onClick={() => setShowModal(false)}
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
    </div>
  )
}
