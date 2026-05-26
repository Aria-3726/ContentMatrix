"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SystemStatus } from "@/components/SystemStatus";
import { SearchPanel } from "@/components/SearchPanel";
import { JobCard, type JobSummary } from "@/components/JobCard";
import { PipelineStats } from "@/components/PipelineStats";

export default function Dashboard() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = (msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchJobs = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json() as { jobs: JobSummary[] };
    setJobs(data.jobs);
  }, []);

  // Poll every 5s when jobs are processing
  useEffect(() => {
    fetchJobs();
    pollRef.current = setInterval(fetchJobs, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchJobs]);

  const handleSearch = async (keyword: string, minViews: number) => {
    setSearchLoading(true);
    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, minViews }),
      });
      const data = await res.json() as { created: number; existing: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "搜索失败");
      showToast(`发现 ${data.created} 条新内容，${data.existing} 条已存在`);
      await fetchJobs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "搜索出错", "err");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAction = async (jobId: string, action: string) => {
    if (action === "review") {
      window.location.href = `/review/${jobId}`;
      return;
    }

    setActionLoading(jobId);
    try {
      const res = await fetch(`/api/jobs/${jobId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "操作失败");
      showToast(data.message ?? "操作已启动");
      await fetchJobs();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "操作出错", "err");
    } finally {
      setActionLoading(null);
    }
  };

  const filteredJobs = statusFilter
    ? jobs.filter((j) => j.status === statusFilter)
    : jobs;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">🎮 ContentMatrix</h1>
            <p className="text-xs text-gray-500">Pocomo · 海外三方号内容工作流</p>
          </div>
          <div className="text-xs text-gray-400">{jobs.length} 条任务</div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* System Status */}
        <SystemStatus />

        {/* Search */}
        <SearchPanel onSearch={handleSearch} isLoading={searchLoading} />

        {/* Pipeline filter pills */}
        <PipelineStats
          jobs={jobs}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
        />

        {/* Jobs grid */}
        {filteredJobs.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-sm">
              {jobs.length === 0
                ? "搜索关键词来发现 B 站内容"
                : "该状态下没有任务"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onAction={handleAction}
                isLoading={actionLoading === job.id}
              />
            ))}
          </div>
        )}
      </main>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-3 rounded-xl text-sm text-white shadow-lg z-50 ${
            toast.type === "ok" ? "bg-gray-900" : "bg-red-600"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
