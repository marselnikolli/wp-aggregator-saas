import { useState, FormEvent } from 'react'
import { Zap, Loader2, ShieldCheck } from 'lucide-react'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export function Login() {
  const [email, setEmail]         = useState('')
  const [password, setPassword]   = useState('')
  const [totpCode, setTotpCode]   = useState('')
  const [totpRequired, setTotpRequired] = useState(false)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await authApi.login(email, password, totpRequired ? totpCode : undefined)
      if (res.totpRequired) {
        setTotpRequired(true)
        return
      }
      localStorage.setItem('token', res.token)
      // Reload so AuthContext picks up the new token
      window.location.href = '/'
    } catch (err: any) {
      setError(err.response?.data?.error ?? 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/30">
            <Zap className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-bold">WP Aggregator</h1>
            <p className="text-sm text-muted-foreground">Sign in to your account</p>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              {totpRequired ? <><ShieldCheck className="h-4 w-4" /> Two-Factor Authentication</> : 'Sign in'}
            </CardTitle>
            <CardDescription>
              {totpRequired ? 'Enter the 6-digit code from your authenticator app' : 'Enter your credentials to continue'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {!totpRequired ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="admin@example.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      required
                    />
                  </div>
                </>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="totp">Authenticator code</Label>
                  <Input
                    id="totp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="000000"
                    value={totpCode}
                    onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="font-mono text-lg tracking-widest text-center"
                    required
                    autoFocus
                  />
                  <button type="button" onClick={() => { setTotpRequired(false); setTotpCode(''); setError('') }}
                    className="text-xs text-muted-foreground hover:text-foreground">
                    ← Back to login
                  </button>
                </div>
              )}

              {error && (
                <p className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={loading || (totpRequired && totpCode.length !== 6)}>
                {loading && <Loader2 className="animate-spin" />}
                {totpRequired ? 'Verify' : 'Sign in'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {!totpRequired && (
          <p className="text-center text-xs text-muted-foreground">
            Default: <code className="text-foreground">admin@example.com</code> / <code className="text-foreground">admin123</code>
          </p>
        )}
      </div>
    </div>
  )
}
