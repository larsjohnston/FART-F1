'use client'
import { useRouter } from 'next/navigation'
import NamePicker from '@/components/NamePicker'

export default function Home() {
  const router = useRouter()
  return <NamePicker onPicked={() => router.push('/draft')} />
}
