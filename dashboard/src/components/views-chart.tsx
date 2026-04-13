"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Props {
  data: { date: string; views: number }[];
}

export function ViewsChart({ data }: Props) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No view data yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="viewsGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#16a34a" stopOpacity={0.12} />
            <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="date"
          tick={{ fontSize: 12, fill: "#86868b" }}
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
        />
        <Area
          type="monotone"
          dataKey="views"
          stroke="#16a34a"
          strokeWidth={2.5}
          fill="url(#viewsGrad)"
          dot={false}
          activeDot={{
            r: 5,
            fill: "#16a34a",
            stroke: "#ffffff",
            strokeWidth: 2.5,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
