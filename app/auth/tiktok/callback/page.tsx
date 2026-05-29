"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function CallbackContent() {
  const params = useSearchParams();
  const code = params.get("code");
  const error = params.get("error");
  const errorDesc = params.get("error_description");

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

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow p-8 max-w-lg w-full text-center space-y-4">
        <p className="text-4xl">✅</p>
        <h1 className="text-xl font-bold text-green-700">TikTok 授权成功</h1>
        <p className="text-sm text-gray-500">
          请复制下面的授权码，粘贴到终端中完成配置：
        </p>
        <div className="bg-gray-100 rounded-lg p-4 break-all font-mono text-sm select-all">
          {code}
        </div>
        <p className="text-xs text-gray-400">
          复制后可以关闭此页面
        </p>
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
