"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

interface TokenData {
  access_token: string;
  refresh_token: string;
  open_id: string;
  expires_in: number;
  refresh_expires_in: number;
  scope: string;
}

function CallbackContent() {
  const params = useSearchParams();
  const code = params.get("code");
  const error = params.get("error");
  const errorDesc = params.get("error_description");

  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [tokens, setTokens] = useState<TokenData | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [copied, setCopied] = useState<Record<string, boolean>>({});
  const hasFetched = useRef(false);

  useEffect(() => {
    if (!code || hasFetched.current) return;
    hasFetched.current = true;
    setState("loading");

    fetch("/api/auth/tiktok/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    })
      .then((r) => r.json())
      .then((data: TokenData & { error?: string }) => {
        if (data.error) {
          setErrMsg(data.error);
          setState("error");
        } else {
          setTokens(data);
          setState("done");
        }
      })
      .catch((e: unknown) => {
        setErrMsg(e instanceof Error ? e.message : String(e));
        setState("error");
      });
  }, [code]);

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied((c) => ({ ...c, [key]: true }));
      setTimeout(() => setCopied((c) => ({ ...c, [key]: false })), 2000);
    });
  }

  function copyAll() {
    if (!tokens) return;
    const text = [
      `TIKTOK_ACCESS_TOKEN=${tokens.access_token}`,
      `TIKTOK_REFRESH_TOKEN=${tokens.refresh_token}`,
      `TIKTOK_OPEN_ID=${tokens.open_id}`,
    ].join("\n");
    copyToClipboard(text, "all");
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-lg w-full text-center">
          <p className="text-4xl mb-4">❌</p>
          <h1 className="text-xl font-bold text-red-600 mb-2">授权失败</h1>
          <p className="text-gray-600 text-sm">{errorDesc ?? error}</p>
        </div>
      </div>
    );
  }

  if (!code) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-lg w-full text-center">
          <p className="text-gray-500">等待授权回调…</p>
        </div>
      </div>
    );
  }

  if (state === "loading" || state === "idle") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-lg w-full text-center space-y-3">
          <p className="text-2xl animate-spin inline-block">⏳</p>
          <p className="text-gray-600">正在换取 Token…</p>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-lg w-full text-center space-y-3">
          <p className="text-4xl">❌</p>
          <h1 className="text-xl font-bold text-red-600">Token 换取失败</h1>
          <p className="text-sm text-gray-600 bg-red-50 rounded p-2">{errMsg}</p>
          <p className="text-xs text-gray-400">
            请重新点击「连接 TikTok」重试
          </p>
        </div>
      </div>
    );
  }

  // state === "done"
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow p-8 max-w-2xl w-full space-y-5">
        <div className="text-center">
          <p className="text-4xl mb-2">✅</p>
          <h1 className="text-xl font-bold text-green-700">TikTok 授权成功！</h1>
          <p className="text-sm text-gray-500 mt-1">
            请将以下环境变量添加到 Vercel Dashboard → Settings → Environment Variables
          </p>
        </div>

        {tokens && (
          <div className="space-y-3">
            {[
              { label: "TIKTOK_ACCESS_TOKEN", value: tokens.access_token, key: "at" },
              { label: "TIKTOK_REFRESH_TOKEN", value: tokens.refresh_token, key: "rt" },
              { label: "TIKTOK_OPEN_ID", value: tokens.open_id, key: "oid" },
            ].map(({ label, value, key }) => (
              <div key={key}>
                <p className="text-xs font-mono text-gray-500 mb-1">{label}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-xs font-mono break-all">
                    {value}
                  </code>
                  <button
                    onClick={() => copyToClipboard(value, key)}
                    className="shrink-0 text-xs px-2 py-1 bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                  >
                    {copied[key] ? "✓" : "复制"}
                  </button>
                </div>
              </div>
            ))}

            <button
              onClick={copyAll}
              className="w-full py-2 bg-black text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
            >
              {copied["all"] ? "✓ 已复制全部" : "📋 一键复制全部环境变量"}
            </button>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 space-y-1">
              <p className="font-semibold">添加步骤：</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>打开 <a href="https://vercel.com/dashboard" target="_blank" className="underline">Vercel Dashboard</a> → 选择 ContentMatrix 项目</li>
                <li>Settings → Environment Variables</li>
                <li>逐一添加上面三个变量（或直接粘贴到 .env 本地测试）</li>
                <li>重新部署应用使变量生效</li>
              </ol>
              <p className="mt-2 text-blue-600">
                Access token 有效期：{Math.round((tokens.expires_in ?? 0) / 3600)} 小时 ·
                Refresh token 有效期：{Math.round((tokens.refresh_expires_in ?? 0) / 86400)} 天
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TikTokCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <p className="text-gray-500">加载中…</p>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
