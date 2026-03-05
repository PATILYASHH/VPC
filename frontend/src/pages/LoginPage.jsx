import { useState } from 'react';
import useAuthStore from '@/stores/useAuthStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Server } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [totpStep, setTotpStep] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const login = useAuthStore((s) => s.login);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (totpStep) {
        await login(null, null, { tempToken, totpCode });
      } else {
        const result = await login(email, password);
        if (result?.requireTotp) {
          setTempToken(result.tempToken);
          setTotpStep(true);
          setLoading(false);
          return;
        }
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed');
      if (totpStep) setTotpCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm mx-auto">
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Server className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">VPC Control</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totpStep ? 'Two-Factor Authentication' : 'Virtual PC Management Dashboard'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {!totpStep ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="text"
                  placeholder="admin@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="totp">Authentication Code</Label>
              <p className="text-xs text-muted-foreground">
                Enter the 6-digit code from your authenticator app
              </p>
              <Input
                id="totp"
                type="text"
                inputMode="numeric"
                placeholder="000000"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                required
                maxLength={6}
                className="text-center text-lg font-mono tracking-widest"
              />
              <button
                type="button"
                className="text-xs text-muted-foreground underline"
                onClick={() => { setTotpStep(false); setTempToken(''); setTotpCode(''); setError(''); }}
              >
                Back to login
              </button>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Signing in...' : totpStep ? 'Verify' : 'Sign In'}
          </Button>
        </form>
      </div>
    </div>
  );
}
