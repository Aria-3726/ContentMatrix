"use client";

import { useState } from "react";

interface SearchPanelProps {
  onSearch: (keyword: string, minViews: number) => void;
  isLoading: boolean;
}

const PRESET_KEYWORDS = [
  "pocomo",
  "pocomo攻略",
  "pocomo新手",
  "pocomo宠物",
  "pocomo活动",
];

export function SearchPanel({ onSearch, isLoading }: SearchPanelProps) {
  const [keyword, setKeyword] = useState("pocomo");
  const [minViews, setMinViews] = useState(5000);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (keyword.trim()) onSearch(keyword.trim(), minViews);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 mb-6">
      <h2 className="font-semibold text-gray-800 mb-3">🔍 B站内容采集</h2>
      <form onSubmit={handleSubmit} className="flex gap-2 flex-wrap">
        <input
          type="text"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索关键词"
          className="flex-1 min-w-0 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 whitespace-nowrap">
            最低播放量
          </label>
          <select
            value={minViews}
            onChange={(e) => setMinViews(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={1000}>1千+</option>
            <option value={5000}>5千+</option>
            <option value={10000}>1万+</option>
            <option value={50000}>5万+</option>
            <option value={100000}>10万+</option>
          </select>
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          {isLoading ? "搜索中…" : "搜索"}
        </button>
      </form>

      {/* Quick presets */}
      <div className="flex flex-wrap gap-2 mt-3">
        {PRESET_KEYWORDS.map((kw) => (
          <button
            key={kw}
            onClick={() => {
              setKeyword(kw);
              onSearch(kw, minViews);
            }}
            className="text-xs px-2 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
          >
            {kw}
          </button>
        ))}
      </div>
    </div>
  );
}
