import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/context/AuthContext'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'

export function Account() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  const update = useMutation({
    mutationFn: () => {
      const body: Record<string, string> = {}
      if (name !== user?.name) body.name = name
      if (email !== user?.email) {
        body.email = email
        if (!currentPassword) { toast.error('Current password required to change email'); throw new Error('validation') }
        body.currentPassword = currentPassword
      }
      if (newPassword) {
        if (!currentPassword) { toast.error('Current password required to set new password'); throw new Error('validation') }
        body.currentPassword = currentPassword
        body.newPassword = newPassword
      }
      return authApi.updateMe(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      setCurrentPassword('')
      setNewPassword('')
      toast.success('Profile updated')
    },
    onError: (e: any) => {
      if (e?.message === 'validation') return
      toast.error(e?.response?.data?.error ?? 'Update failed')
    },
  })

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="max-w-lg">
        <h1 className="text-2xl font-bold mb-1">Account</h1>
        <p className="text-sm text-muted-foreground mb-6">Edit your profile details</p>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
            <CardDescription>Update your name, email, or password</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your display name" />
            </div>

            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="you@example.com" />
            </div>

            <div className="border-t border-border pt-4">
              <p className="text-xs font-medium text-muted-foreground mb-3">Change password (leave blank to keep current)</p>
              <div className="grid gap-1.5 mb-3">
                <Label>Current password</Label>
                <Input value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} type="password" placeholder="Required for email or password changes" />
              </div>
              <div className="grid gap-1.5">
                <Label>New password</Label>
                <Input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" placeholder="Min 6 characters" />
              </div>
            </div>

            <Button onClick={() => update.mutate()} disabled={update.isPending} className="w-full">
              {update.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              <Save className="h-4 w-4 mr-1" /> Save changes
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
