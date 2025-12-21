import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge } from "../components/ui";

export default function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) nav("/");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendLink() {
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          // Supabase will redirect back to your site after link click
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) throw error;
      setMsg("Magic link sent. Check your email.");
    } catch (e: any) {
      setMsg(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Founder Login</CardTitle>
            <Badge tone="gold">Supabase Auth</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-zinc-300">
            Cockpit is an operator surface. Identity is mandatory.
          </div>
          <div>
            <div className="text-xs text-zinc-400 mb-1">Email</div>
            <Input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
            />
          </div>
          <Button onClick={sendLink} disabled={busy || !email.trim()}>
            {busy ? "Sending…" : "Send Magic Link"}
          </Button>
          {msg ? <div className="text-sm text-zinc-300">{msg}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
