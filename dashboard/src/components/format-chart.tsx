"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface FormatRanking {
  hook_style: string;
  avg_views: number;
  avg_save_rate: number;
  post_count: number;
}

const COLORS = ["#16a34a", "#5856d6", "#248a3d", "#bf4800"];

export function FormatChart({ data }: { data: FormatRanking[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <XAxis
          dataKey="hook_style"
          tick={{ fontSize: 13, fill: "#86868b", fontWeight: 500 }}
          stroke="transparent"
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fontSize: 12, fill: "#86868b" }}
          stroke="transparent"
          tickLine={false}
          axisLine={false}
          width={45}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#ffffff",
            border: "1px solid #e8e8ed",
            borderRadius: "12px",
            color: "#1d1d1f",
            fontSize: "13px",
            fontWeight: 500,
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
          }}
          labelStyle={{ color: "#86868b", fontSize: 12 }}
          cursor={{ fill: "rgba(0,0,0,0.02)" }}
        />
        <Bar dataKey="avg_views" radius={[8, 8, 0, 0]} name="Avg Views">
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
