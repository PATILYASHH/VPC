import { useState, useRef, useCallback } from 'react';
import useAuthStore from '@/stores/useAuthStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Server, ShieldCheck } from 'lucide-react';

function OtpInput({ value, onChange, autoFocus }) {
  const inputsRef = useRef([]);
  const digits = value.padEnd(6, '').split('').slice(0, 6);

  const focusInput = (index) => {
    inputsRef.current[index]?.focus();
    inputsRef.current[index]?.select();
  };

  const handleChange = useCallback((index, e) => {
    const val = e.target.value.replace(/\D/g, '');
    if (!val) return;
    const char = val.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = char;
    onChange(newDigits.join('').replace(/ /g, ''));
    if (index < 5) {
      setTimeout(() => focusInput(index + 1), 0);
    }
  }, [digits, onChange]);

  const handleKeyDown = useCallback((index, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const newDigits = [...digits];
      if (newDigits[index] && newDigits[index] !== ' ') {
        newDigits[index] = ' ';
        onChange(newDigits.join('').trim());
      } else if (index > 0) {
        newDigits[index - 1] = ' ';
        onChange(newDigits.join('').trim());
        setTimeout(() => focusInput(index - 1), 0);
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight' && index < 5) {
      focusInput(index + 1);
    }
  }, [digits, onChange]);

  const handlePaste = useCallback((e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted) {
      onChange(pasted);
      setTimeout(() => focusInput(Math.min(pasted.length, 5)), 0);
    }
  }, [onChange]);

  return (
    <div className="flex gap-2 justify-center">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <input
          key={i}
          ref={(el) => (inputsRef.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digits[i]?.trim() || ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          autoFocus={autoFocus && i === 0}
          className="w-10 h-12 sm:w-11 sm:h-13 text-center text-lg sm:text-xl font-mono font-semibold rounded-md border border-input bg-background ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 transition-all"
        />
      ))}
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authCode, setAuthCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [totpStep, setTotpStep] = useState(false);
  const [tempToken, setTempToken] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [loginMode, setLoginMode] = useState('password'); // 'password' or 'authenticator'
  const login = useAuthStore((s) => s.login);
  const loginWithAuthenticator = useAuthStore((s) => s.loginWithAuthenticator);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (loginMode === 'authenticator') {
        await loginWithAuthenticator(authEmail, authCode);
      } else if (totpStep) {
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
      if (loginMode === 'authenticator') setAuthCode('');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (mode) => {
    setLoginMode(mode);
    setError('');
    setTotpStep(false);
    setTempToken('');
    setTotpCode('');
    setAuthCode('');
    setAuthEmail('');
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm mx-auto">
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
            <Server className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">VPC Control</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {totpStep
              ? 'Two-Factor Authentication'
              : loginMode === 'authenticator'
                ? 'Login with Authenticator'
                : 'Virtual PC Management Dashboard'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {loginMode === 'authenticator' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="authEmail">Email or Username</Label>
                <Input
                  id="authEmail"
                  type="text"
                  placeholder="admin@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>
              <div className="space-y-3">
                <Label>Authenticator Code</Label>
                <p className="text-xs text-muted-foreground">
                  Enter the 6-digit code from Google Authenticator
                </p>
                <OtpInput value={authCode} onChange={setAuthCode} />
              </div>
            </>
          ) : !totpStep ? (
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
            <div className="space-y-3">
              <Label>Authentication Code</Label>
              <p className="text-xs text-muted-foreground">
                Enter the 6-digit code from your authenticator app
              </p>
              <OtpInput value={totpCode} onChange={setTotpCode} autoFocus />
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

          <Button type="submit" className="w-full" disabled={loading || (totpStep && totpCode.length !== 6) || (loginMode === 'authenticator' && authCode.length !== 6)}>
            {loading ? 'Signing in...' : totpStep ? 'Verify' : 'Sign In'}
          </Button>
        </form>

        {!totpStep && (
          <div className="mt-4 text-center">
            {loginMode === 'password' ? (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5"
                onClick={() => switchMode('authenticator')}
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Login with authenticator code
              </button>
            ) : (
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => switchMode('password')}
              >
                Back to password login
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
