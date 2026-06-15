export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      ai_analysis_cache: {
        Row: {
          cache_key: string
          created_at: string
          expires_at: string
          model: string
          payload: Json
          symbol: string
          timeframe: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          expires_at: string
          model: string
          payload: Json
          symbol: string
          timeframe: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          expires_at?: string
          model?: string
          payload?: Json
          symbol?: string
          timeframe?: string
        }
        Relationships: []
      }
      auto_trade_settings: {
        Row: {
          after_hours_crypto_only_mode: boolean
          auto_scale_baseline_equity: number | null
          auto_scale_enabled: boolean
          bearish_crypto_block: boolean
          bearish_stock_weight: number
          block_crypto_mean_reversion: boolean
          chandelier_atr_mult: number
          confidence_threshold: number
          cooldown_seconds: number
          dynamic_sizing_enabled: boolean
          enabled: boolean
          exit_mode: string
          grade_a_size_mult: number
          grade_b_size_mult: number
          halt_reason: string | null
          halted_at: string | null
          hard_confidence_floor: number
          id: string
          limit_price_offset_bps: number
          max_hold_minutes: number
          max_open_positions: number
          max_price: number
          max_trades_per_hour_per_symbol: number
          max_weekly_drawdown_pct: number
          min_price: number
          monday_rule: string
          news_sentiment_gate: boolean
          position_size_pct: number
          prefer_limit_orders: boolean
          premarket_scanner_enabled: boolean
          prime_window_only: boolean
          profit_lock_enabled: boolean
          profit_lock_giveback_pct: number
          profit_lock_target_pct: number
          profit_only_mode: boolean
          queue_delay_seconds: number
          regime_gate_enabled: boolean
          sector_rotation_filter: boolean
          server_side_trading: boolean
          slippage_aware_sizing: boolean
          stop_loss_pct: number
          take_profit_pct: number
          tiered_sizing_by_confidence: boolean
          trading_halted: boolean
          trailing_stop_pct: number
          trailing_tp_enabled: boolean
          trailing_tp_lock_pct: number
          updated_at: string
          user_id: string
          vwap_reclaim_required: boolean
          weekly_pause_until: string | null
        }
        Insert: {
          after_hours_crypto_only_mode?: boolean
          auto_scale_baseline_equity?: number | null
          auto_scale_enabled?: boolean
          bearish_crypto_block?: boolean
          bearish_stock_weight?: number
          block_crypto_mean_reversion?: boolean
          chandelier_atr_mult?: number
          confidence_threshold?: number
          cooldown_seconds?: number
          dynamic_sizing_enabled?: boolean
          enabled?: boolean
          exit_mode?: string
          grade_a_size_mult?: number
          grade_b_size_mult?: number
          halt_reason?: string | null
          halted_at?: string | null
          hard_confidence_floor?: number
          id?: string
          limit_price_offset_bps?: number
          max_hold_minutes?: number
          max_open_positions?: number
          max_price?: number
          max_trades_per_hour_per_symbol?: number
          max_weekly_drawdown_pct?: number
          min_price?: number
          monday_rule?: string
          news_sentiment_gate?: boolean
          position_size_pct?: number
          prefer_limit_orders?: boolean
          premarket_scanner_enabled?: boolean
          prime_window_only?: boolean
          profit_lock_enabled?: boolean
          profit_lock_giveback_pct?: number
          profit_lock_target_pct?: number
          profit_only_mode?: boolean
          queue_delay_seconds?: number
          regime_gate_enabled?: boolean
          sector_rotation_filter?: boolean
          server_side_trading?: boolean
          slippage_aware_sizing?: boolean
          stop_loss_pct?: number
          take_profit_pct?: number
          tiered_sizing_by_confidence?: boolean
          trading_halted?: boolean
          trailing_stop_pct?: number
          trailing_tp_enabled?: boolean
          trailing_tp_lock_pct?: number
          updated_at?: string
          user_id: string
          vwap_reclaim_required?: boolean
          weekly_pause_until?: string | null
        }
        Update: {
          after_hours_crypto_only_mode?: boolean
          auto_scale_baseline_equity?: number | null
          auto_scale_enabled?: boolean
          bearish_crypto_block?: boolean
          bearish_stock_weight?: number
          block_crypto_mean_reversion?: boolean
          chandelier_atr_mult?: number
          confidence_threshold?: number
          cooldown_seconds?: number
          dynamic_sizing_enabled?: boolean
          enabled?: boolean
          exit_mode?: string
          grade_a_size_mult?: number
          grade_b_size_mult?: number
          halt_reason?: string | null
          halted_at?: string | null
          hard_confidence_floor?: number
          id?: string
          limit_price_offset_bps?: number
          max_hold_minutes?: number
          max_open_positions?: number
          max_price?: number
          max_trades_per_hour_per_symbol?: number
          max_weekly_drawdown_pct?: number
          min_price?: number
          monday_rule?: string
          news_sentiment_gate?: boolean
          position_size_pct?: number
          prefer_limit_orders?: boolean
          premarket_scanner_enabled?: boolean
          prime_window_only?: boolean
          profit_lock_enabled?: boolean
          profit_lock_giveback_pct?: number
          profit_lock_target_pct?: number
          profit_only_mode?: boolean
          queue_delay_seconds?: number
          regime_gate_enabled?: boolean
          sector_rotation_filter?: boolean
          server_side_trading?: boolean
          slippage_aware_sizing?: boolean
          stop_loss_pct?: number
          take_profit_pct?: number
          tiered_sizing_by_confidence?: boolean
          trading_halted?: boolean
          trailing_stop_pct?: number
          trailing_tp_enabled?: boolean
          trailing_tp_lock_pct?: number
          updated_at?: string
          user_id?: string
          vwap_reclaim_required?: boolean
          weekly_pause_until?: string | null
        }
        Relationships: []
      }
      backtest_runs: {
        Row: {
          created_at: string
          expectancy: number | null
          id: string
          max_drawdown_pct: number | null
          metrics: Json
          params: Json
          sharpe: number | null
          strategy_name: string
          symbol: string
          test_end: string
          test_start: string
          trades_count: number | null
          train_end: string
          train_start: string
          user_id: string
          win_rate: number | null
        }
        Insert: {
          created_at?: string
          expectancy?: number | null
          id?: string
          max_drawdown_pct?: number | null
          metrics?: Json
          params?: Json
          sharpe?: number | null
          strategy_name: string
          symbol: string
          test_end: string
          test_start: string
          trades_count?: number | null
          train_end: string
          train_start: string
          user_id: string
          win_rate?: number | null
        }
        Update: {
          created_at?: string
          expectancy?: number | null
          id?: string
          max_drawdown_pct?: number | null
          metrics?: Json
          params?: Json
          sharpe?: number | null
          strategy_name?: string
          symbol?: string
          test_end?: string
          test_start?: string
          trades_count?: number | null
          train_end?: string
          train_start?: string
          user_id?: string
          win_rate?: number | null
        }
        Relationships: []
      }
      market_prices_cache: {
        Row: {
          change_pct: number
          high: number | null
          low: number | null
          name: string
          price: number
          symbol: string
          updated_at: string
          volume: string
        }
        Insert: {
          change_pct?: number
          high?: number | null
          low?: number | null
          name?: string
          price?: number
          symbol: string
          updated_at?: string
          volume?: string
        }
        Update: {
          change_pct?: number
          high?: number | null
          low?: number | null
          name?: string
          price?: number
          symbol?: string
          updated_at?: string
          volume?: string
        }
        Relationships: []
      }
      market_regime_cache: {
        Row: {
          adx: number | null
          id: string
          long_bias: number
          min_grade: string
          notes: string | null
          regime: string
          short_bias: number
          size_multiplier: number
          spy_ema20: number | null
          spy_ema50: number | null
          updated_at: string
          vix: number | null
          vix_change_pct: number | null
        }
        Insert: {
          adx?: number | null
          id?: string
          long_bias?: number
          min_grade?: string
          notes?: string | null
          regime?: string
          short_bias?: number
          size_multiplier?: number
          spy_ema20?: number | null
          spy_ema50?: number | null
          updated_at?: string
          vix?: number | null
          vix_change_pct?: number | null
        }
        Update: {
          adx?: number | null
          id?: string
          long_bias?: number
          min_grade?: string
          notes?: string | null
          regime?: string
          short_bias?: number
          size_multiplier?: number
          spy_ema20?: number | null
          spy_ema50?: number | null
          updated_at?: string
          vix?: number | null
          vix_change_pct?: number | null
        }
        Relationships: []
      }
      portfolios: {
        Row: {
          balance: number
          id: string
          total_pnl: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          id?: string
          total_pnl?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          id?: string
          total_pnl?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      position_state: {
        Row: {
          alpaca_order_id: string | null
          atr_at_entry: number
          breakeven_moved: boolean
          created_at: string
          entry_price: number
          high_water_mark: number
          id: string
          initial_qty: number
          low_water_mark: number
          r_dollars: number
          side: string
          symbol: string
          tier1_filled: boolean
          tier2_filled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          alpaca_order_id?: string | null
          atr_at_entry?: number
          breakeven_moved?: boolean
          created_at?: string
          entry_price: number
          high_water_mark: number
          id?: string
          initial_qty: number
          low_water_mark: number
          r_dollars: number
          side: string
          symbol: string
          tier1_filled?: boolean
          tier2_filled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          alpaca_order_id?: string | null
          atr_at_entry?: number
          breakeven_moved?: boolean
          created_at?: string
          entry_price?: number
          high_water_mark?: number
          id?: string
          initial_qty?: number
          low_water_mark?: number
          r_dollars?: number
          side?: string
          symbol?: string
          tier1_filled?: boolean
          tier2_filled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      positions: {
        Row: {
          created_at: string
          entry_price: number
          id: string
          quantity: number
          side: string
          symbol: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entry_price: number
          id?: string
          quantity: number
          side: string
          symbol: string
          user_id: string
        }
        Update: {
          created_at?: string
          entry_price?: number
          id?: string
          quantity?: number
          side?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      research_notes: {
        Row: {
          category: string
          content: string
          created_at: string
          id: string
          is_actionable: boolean | null
          priority: number | null
          source_urls: string[] | null
          tags: string[] | null
          title: string
          topic: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          id?: string
          is_actionable?: boolean | null
          priority?: number | null
          source_urls?: string[] | null
          tags?: string[] | null
          title: string
          topic: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          id?: string
          is_actionable?: boolean | null
          priority?: number | null
          source_urls?: string[] | null
          tags?: string[] | null
          title?: string
          topic?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      signal_copies: {
        Row: {
          confidence: number | null
          copied_at: string
          created_at: string
          entry_price: number
          executed: boolean | null
          executed_at: string | null
          execution_notes: string | null
          execution_price: number | null
          grade: string | null
          id: string
          outcome: string | null
          pnl: number | null
          position_value: number
          qty: number
          risk_pct: number
          rr_ratio: number | null
          side: string
          signal_reasons: string[] | null
          sl_price: number
          symbol: string
          tp_price: number
          user_id: string
        }
        Insert: {
          confidence?: number | null
          copied_at?: string
          created_at?: string
          entry_price: number
          executed?: boolean | null
          executed_at?: string | null
          execution_notes?: string | null
          execution_price?: number | null
          grade?: string | null
          id?: string
          outcome?: string | null
          pnl?: number | null
          position_value?: number
          qty?: number
          risk_pct?: number
          rr_ratio?: number | null
          side: string
          signal_reasons?: string[] | null
          sl_price: number
          symbol: string
          tp_price: number
          user_id: string
        }
        Update: {
          confidence?: number | null
          copied_at?: string
          created_at?: string
          entry_price?: number
          executed?: boolean | null
          executed_at?: string | null
          execution_notes?: string | null
          execution_price?: number | null
          grade?: string | null
          id?: string
          outcome?: string | null
          pnl?: number | null
          position_value?: number
          qty?: number
          risk_pct?: number
          rr_ratio?: number | null
          side?: string
          signal_reasons?: string[] | null
          sl_price?: number
          symbol?: string
          tp_price?: number
          user_id?: string
        }
        Relationships: []
      }
      strategy_history: {
        Row: {
          actual_pnl_pct: number | null
          analysis_mode: string | null
          confidence: number
          created_at: string
          current_price_at_gen: number
          entry_hit: boolean | null
          entry_hit_at: string | null
          id: string
          indicators: Json | null
          notes: string | null
          outcome: string | null
          overall_bias: string
          preset: string | null
          reasoning: string[] | null
          resolved_at: string | null
          risk_assessment: Json | null
          signals: Json
          sl_hit: boolean | null
          sl_hit_at: string | null
          strategy_name: string
          symbol: string
          tp_hit: boolean | null
          tp_hit_at: string | null
          user_id: string
        }
        Insert: {
          actual_pnl_pct?: number | null
          analysis_mode?: string | null
          confidence: number
          created_at?: string
          current_price_at_gen: number
          entry_hit?: boolean | null
          entry_hit_at?: string | null
          id?: string
          indicators?: Json | null
          notes?: string | null
          outcome?: string | null
          overall_bias: string
          preset?: string | null
          reasoning?: string[] | null
          resolved_at?: string | null
          risk_assessment?: Json | null
          signals?: Json
          sl_hit?: boolean | null
          sl_hit_at?: string | null
          strategy_name: string
          symbol: string
          tp_hit?: boolean | null
          tp_hit_at?: string | null
          user_id: string
        }
        Update: {
          actual_pnl_pct?: number | null
          analysis_mode?: string | null
          confidence?: number
          created_at?: string
          current_price_at_gen?: number
          entry_hit?: boolean | null
          entry_hit_at?: string | null
          id?: string
          indicators?: Json | null
          notes?: string | null
          outcome?: string | null
          overall_bias?: string
          preset?: string | null
          reasoning?: string[] | null
          resolved_at?: string | null
          risk_assessment?: Json | null
          signals?: Json
          sl_hit?: boolean | null
          sl_hit_at?: string | null
          strategy_name?: string
          symbol?: string
          tp_hit?: boolean | null
          tp_hit_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trade_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          latency_ms: number | null
          order_id: string | null
          payload: Json
          signal_id: string | null
          symbol: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          latency_ms?: number | null
          order_id?: string | null
          payload?: Json
          signal_id?: string | null
          symbol?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          latency_ms?: number | null
          order_id?: string | null
          payload?: Json
          signal_id?: string | null
          symbol?: string | null
          user_id?: string
        }
        Relationships: []
      }
      trade_journal: {
        Row: {
          alpaca_order_id: string | null
          chart_snapshot: Json | null
          confidence: number | null
          created_at: string
          entry_price: number | null
          entry_quality: string | null
          exit_price: number | null
          filled_price: number
          holding_time_ms: number | null
          id: string
          lessons_learned: string | null
          market_session: string | null
          mode: string
          notes: string | null
          order_class: string | null
          order_type: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          rating: number | null
          risk_reward: number | null
          sector: string | null
          side: string
          signal_price: number | null
          signal_type: string | null
          slippage_bps: number | null
          stat_edge_score: number | null
          symbol: string
          tags: string[] | null
          trade_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alpaca_order_id?: string | null
          chart_snapshot?: Json | null
          confidence?: number | null
          created_at?: string
          entry_price?: number | null
          entry_quality?: string | null
          exit_price?: number | null
          filled_price: number
          holding_time_ms?: number | null
          id?: string
          lessons_learned?: string | null
          market_session?: string | null
          mode?: string
          notes?: string | null
          order_class?: string | null
          order_type?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          rating?: number | null
          risk_reward?: number | null
          sector?: string | null
          side: string
          signal_price?: number | null
          signal_type?: string | null
          slippage_bps?: number | null
          stat_edge_score?: number | null
          symbol: string
          tags?: string[] | null
          trade_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alpaca_order_id?: string | null
          chart_snapshot?: Json | null
          confidence?: number | null
          created_at?: string
          entry_price?: number | null
          entry_quality?: string | null
          exit_price?: number | null
          filled_price?: number
          holding_time_ms?: number | null
          id?: string
          lessons_learned?: string | null
          market_session?: string | null
          mode?: string
          notes?: string | null
          order_class?: string | null
          order_type?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          rating?: number | null
          risk_reward?: number | null
          sector?: string | null
          side?: string
          signal_price?: number | null
          signal_type?: string | null
          slippage_bps?: number | null
          stat_edge_score?: number | null
          symbol?: string
          tags?: string[] | null
          trade_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trades: {
        Row: {
          created_at: string
          id: string
          pnl: number | null
          price: number
          quantity: number
          side: string
          symbol: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          pnl?: number | null
          price: number
          quantity: number
          side: string
          symbol: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          pnl?: number | null
          price?: number
          quantity?: number
          side?: string
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_expired_ai_cache: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
