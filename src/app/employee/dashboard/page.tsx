'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getCurrentPosition, getDistanceMeters } from '@/lib/gps'
import { format } from 'date-fns'
import { id } from 'date-fns/locale'

interface Location {
  id: string
  name: string
  latitude: number
  longitude: number
  radius_meter: number
}

interface Attendance {
  id: string
  check_in_time: string
  check_out_time: string | null
  total_hours: number | null
  status: string
  locations: { name: string }
}

export default function EmployeeDashboard() {
  const supabase = createClient()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [user, setUser] = useState<{ id: string; name: string } | null>(null)
  const [locations, setLocations] = useState<Location[]>([])
  const [todayAttendance, setTodayAttendance] = useState<Attendance | null>(null)
  const [recentAttendances, setRecentAttendances] = useState<Attendance[]>([])

  const [step, setStep] = useState<'idle' | 'gps' | 'camera' | 'submitting'>('idle')
  const [actionType, setActionType] = useState<'in' | 'out'>('in')
  const [gpsStatus, setGpsStatus] = useState('')
  const [gpsCoords, setGpsCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [matchedLocation, setMatchedLocation] = useState<Location | null>(null)
  const [capturedImage, setCapturedImage] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [now, setNow] = useState(new Date())

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const loadData = useCallback(async () => {
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return

    const { data: profile } = await supabase
      .from('users').select('id,name').eq('id', authUser.id).single()
    if (profile) setUser(profile)

    const { data: locs } = await supabase
      .from('locations').select('*').eq('is_active', true)
    if (locs) setLocations(locs)

      const now = new Date()
      const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const { data: todayAtt } = await supabase
        .from('attendances')
        .select('*, locations(name)')
        .eq('user_id', authUser.id)
        .gte('check_in_time', todayLocal + 'T00:00:00+07:00')
        .lte('check_in_time', todayLocal + 'T23:59:59+07:00')
        .maybeSingle()
    setTodayAttendance(todayAtt)

    const { data: recent } = await supabase
      .from('attendances')
      .select('*, locations(name)')
      .eq('user_id', authUser.id)
      .order('check_in_time', { ascending: false })
      .limit(7)
    if (recent) setRecentAttendances(recent)
  }, [supabase])

  useEffect(() => { loadData() }, [loadData])

  async function handleStartAbsen(type: 'in' | 'out') {
    setActionType(type)
    setStep('gps')
    setGpsStatus('Mengambil lokasi GPS...')
    setMessage(null)
    setCapturedImage(null)
    setMatchedLocation(null)

    try {
      const pos = await getCurrentPosition()
      const { latitude, longitude } = pos.coords
      setGpsCoords({ lat: latitude, lng: longitude })

      const found = locations.find(loc =>
        getDistanceMeters(
          { latitude, longitude },
          { latitude: loc.latitude, longitude: loc.longitude }
        ) <= loc.radius_meter
      )

      if (!found) {
        setStep('idle')
        setMessage({ type: 'error', text: 'Lokasi GPS Anda tidak sesuai dengan lokasi kerja yang ditentukan.' })
        return
      }

      setMatchedLocation(found)
      setGpsStatus(`Lokasi valid: ${found.name}`)
      setStep('camera')
      startCamera()
    } catch {
      setStep('idle')
      setGpsStatus('Gagal mendapatkan GPS. Pastikan izin lokasi diaktifkan.')
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' }, audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    } catch {
      setMessage({ type: 'error', text: 'Gagal membuka kamera. Izinkan akses kamera.' })
      setStep('idle')
    }
  }

  function stopCamera() {
    const stream = videoRef.current?.srcObject as MediaStream | null
    stream?.getTracks().forEach(t => t.stop())
    if (videoRef.current) videoRef.current.srcObject = null
  }

  function capturePhoto() {
    if (!videoRef.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    canvasRef.current.width = videoRef.current.videoWidth
    canvasRef.current.height = videoRef.current.videoHeight
    ctx?.drawImage(videoRef.current, 0, 0)
    setCapturedImage(canvasRef.current.toDataURL('image/jpeg', 0.8))
    stopCamera()
  }

  function retakePhoto() {
    setCapturedImage(null)
    startCamera()
  }

  async function submitAbsen() {
    if (!capturedImage || !gpsCoords || !matchedLocation || !user) return
    setStep('submitting')

    try {
      // Upload foto selfie ke Supabase Storage
      const blob = await (await fetch(capturedImage)).blob()
      const fileName = `${user.id}/${actionType}-${Date.now()}.jpg`
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('selfies')
        .upload(fileName, blob, { contentType: 'image/jpeg' })

      if (uploadError) throw uploadError

      // ✅ Simpan storage PATH (bukan public URL) agar bisa generate signed URL nanti
      const selfieStoragePath = uploadData.path

      if (actionType === 'in') {
        const { error } = await supabase.from('attendances').insert({
          user_id: user.id,
          location_id: matchedLocation.id,
          check_in_time: new Date().toISOString(),
          check_in_lat: gpsCoords.lat,
          check_in_lng: gpsCoords.lng,
          selfie_in_url: selfieStoragePath,   // path, bukan URL
          status: new Date().getHours() >= 17 ? 'late' : 'present',
        })
        if (error) throw error
        setMessage({ type: 'success', text: 'Absen masuk berhasil!' })
      } else {
        if (!todayAttendance) throw new Error('Tidak ada data absen masuk hari ini')
        const { error } = await supabase.from('attendances').update({
          check_out_time: new Date().toISOString(),
          check_out_lat: gpsCoords.lat,
          check_out_lng: gpsCoords.lng,
          selfie_out_url: selfieStoragePath,  // path, bukan URL
        }).eq('id', todayAttendance.id)
        if (error) throw error
        setMessage({ type: 'success', text: 'Absen pulang berhasil!' })
      }

      setStep('idle')
      loadData()
    } catch (err: unknown) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Terjadi kesalahan' })
      setStep('idle')
    }
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const hasCheckedIn = !!todayAttendance
  const hasCheckedOut = !!todayAttendance?.check_out_time

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-blue-600 text-white px-4 pt-safe pb-6">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-blue-200 text-sm">Selamat datang,</p>
            <h1 className="text-xl font-bold">{user?.name ?? '...'}</h1>
          </div>
          <button onClick={handleLogout} className="text-blue-200 hover:text-white text-sm">Keluar</button>
        </div>
        <div className="mt-4 text-center">
          <p className="text-4xl font-mono font-bold">{format(now, 'HH:mm:ss')}</p>
          <p className="text-blue-200 text-sm mt-1">
            {format(now, 'EEEE, d MMMM yyyy', { locale: id })}
          </p>
        </div>
      </div>

      <div className="px-4 -mt-3 space-y-4 pb-8">
        {/* Status hari ini */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Status Hari Ini</p>
          <div className="flex gap-3">
            <div className={`flex-1 rounded-xl p-3 text-center ${hasCheckedIn ? 'bg-green-50' : 'bg-gray-50'}`}>
              <p className="text-xs text-gray-500">Masuk</p>
              <p className={`text-sm font-bold mt-1 ${hasCheckedIn ? 'text-green-700' : 'text-gray-400'}`}>
                {hasCheckedIn ? format(new Date(todayAttendance!.check_in_time), 'HH:mm') : '--:--'}
              </p>
            </div>
            <div className={`flex-1 rounded-xl p-3 text-center ${hasCheckedOut ? 'bg-blue-50' : 'bg-gray-50'}`}>
              <p className="text-xs text-gray-500">Pulang</p>
              <p className={`text-sm font-bold mt-1 ${hasCheckedOut ? 'text-blue-700' : 'text-gray-400'}`}>
                {hasCheckedOut ? format(new Date(todayAttendance!.check_out_time!), 'HH:mm') : '--:--'}
              </p>
            </div>
            <div className={`flex-1 rounded-xl p-3 text-center ${hasCheckedOut ? 'bg-purple-50' : 'bg-gray-50'}`}>
              <p className="text-xs text-gray-500">Durasi</p>
              <p className={`text-sm font-bold mt-1 ${hasCheckedOut ? 'text-purple-700' : 'text-gray-400'}`}>
                {hasCheckedOut ? `${todayAttendance!.total_hours?.toFixed(1)}j` : '--'}
              </p>
            </div>
          </div>
        </div>

        {/* Pesan */}
        {message && (
          <div className={`rounded-2xl px-4 py-3 text-sm font-medium ${
            message.type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {message.text}
          </div>
        )}

        {/* Kamera */}
        {step === 'camera' && (
          <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
            <div className="bg-green-50 px-4 py-3">
              <p className="text-sm text-green-700 font-medium">{gpsStatus}</p>
            </div>
            <div className="relative bg-black aspect-square">
              {!capturedImage
                ? <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
                : <img src={capturedImage} className="w-full h-full object-cover" alt="selfie" />
              }
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <div className="p-4 flex gap-3">
              {!capturedImage ? (
                <>
                  <button onClick={() => { stopCamera(); setStep('idle') }}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium">
                    Batal
                  </button>
                  <button onClick={capturePhoto}
                    className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-sm font-bold">
                    Ambil Foto
                  </button>
                </>
              ) : (
                <>
                  <button onClick={retakePhoto}
                    className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium">
                    Ulang
                  </button>
                  <button onClick={submitAbsen}
                    className="flex-1 py-3 rounded-xl bg-green-600 text-white text-sm font-bold">
                    {actionType === 'in' ? 'Absen Masuk' : 'Absen Pulang'}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Loading states */}
        {(step === 'submitting' || step === 'gps') && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-gray-600 text-sm">
              {step === 'gps' ? 'Mengambil lokasi GPS...' : 'Menyimpan absensi...'}
            </p>
          </div>
        )}

        {/* Tombol absen */}
        {step === 'idle' && (
          <div className="flex gap-3">
            <button
              onClick={() => handleStartAbsen('in')}
              disabled={hasCheckedIn}
              className={`flex-1 py-4 rounded-2xl font-bold text-sm shadow-sm transition-all ${
                hasCheckedIn
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-green-600 text-white hover:bg-green-700 active:scale-95'
              }`}
            >
              {hasCheckedIn ? 'Sudah Masuk' : 'Absen Masuk'}
            </button>
            <button
              onClick={() => handleStartAbsen('out')}
              disabled={!hasCheckedIn || hasCheckedOut}
              className={`flex-1 py-4 rounded-2xl font-bold text-sm shadow-sm transition-all ${
                !hasCheckedIn || hasCheckedOut
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
              }`}
            >
              {hasCheckedOut ? 'Sudah Pulang' : 'Absen Pulang'}
            </button>
          </div>
        )}

        {/* Riwayat */}
        <div className="bg-white rounded-2xl shadow-sm p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-medium mb-3">Riwayat Absensi</p>
          {recentAttendances.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">Belum ada data absensi</p>
          ) : (
            <div className="space-y-3">
              {recentAttendances.map(att => (
                <div key={att.id}
                  className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {format(new Date(att.check_in_time), 'd MMM yyyy', { locale: id })}
                    </p>
                    <p className="text-xs text-gray-500">
                      {format(new Date(att.check_in_time), 'HH:mm')} →{' '}
                      {att.check_out_time
                        ? format(new Date(att.check_out_time), 'HH:mm')
                        : 'Belum absen pulang'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-700">
                      {att.total_hours ? `${att.total_hours.toFixed(1)}j` : '-'}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      att.status === 'present' ? 'bg-green-100 text-green-700' :
                      att.status === 'late'    ? 'bg-yellow-100 text-yellow-700' :
                                                 'bg-red-100 text-red-700'
                    }`}>
                      {att.status === 'present' ? 'Hadir' :
                       att.status === 'late'    ? 'Terlambat' : 'Tidak Lengkap'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
