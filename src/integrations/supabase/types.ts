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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_log: {
        Row: {
          action: string
          admin_email: string | null
          admin_user_id: string
          created_at: string
          description: string
          id: string
          metadata: Json
          target_user_id: string
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_user_id: string
          created_at?: string
          description: string
          id?: string
          metadata?: Json
          target_user_id: string
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_user_id?: string
          created_at?: string
          description?: string
          id?: string
          metadata?: Json
          target_user_id?: string
        }
        Relationships: []
      }
      affiliate_campaigns: {
        Row: {
          affiliate_id: string
          channel: string | null
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          affiliate_id: string
          channel?: string | null
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          affiliate_id?: string
          channel?: string | null
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_campaigns_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_clicks: {
        Row: {
          affiliate_id: string | null
          browser: string | null
          campaign_slug: string | null
          created_at: string
          device: string | null
          id: string
          ip_hash: string | null
          landing_path: string | null
          os: string | null
          ref_code: string
          referer: string | null
          source: string | null
          user_agent: string | null
          utm: Json | null
        }
        Insert: {
          affiliate_id?: string | null
          browser?: string | null
          campaign_slug?: string | null
          created_at?: string
          device?: string | null
          id?: string
          ip_hash?: string | null
          landing_path?: string | null
          os?: string | null
          ref_code: string
          referer?: string | null
          source?: string | null
          user_agent?: string | null
          utm?: Json | null
        }
        Update: {
          affiliate_id?: string | null
          browser?: string | null
          campaign_slug?: string | null
          created_at?: string
          device?: string | null
          id?: string
          ip_hash?: string | null
          landing_path?: string | null
          os?: string | null
          ref_code?: string
          referer?: string | null
          source?: string | null
          user_agent?: string | null
          utm?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_clicks_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          available_at: string | null
          commission_cents: number
          commission_pct: number
          created_at: string
          gross_cents: number
          id: string
          note: string | null
          paid_at: string | null
          payout_id: string | null
          plan_slug: string | null
          referral_id: string | null
          status: string
          subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          affiliate_id: string
          available_at?: string | null
          commission_cents?: number
          commission_pct?: number
          created_at?: string
          gross_cents?: number
          id?: string
          note?: string | null
          paid_at?: string | null
          payout_id?: string | null
          plan_slug?: string | null
          referral_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          affiliate_id?: string
          available_at?: string | null
          commission_cents?: number
          commission_pct?: number
          created_at?: string
          gross_cents?: number
          id?: string
          note?: string | null
          paid_at?: string | null
          payout_id?: string | null
          plan_slug?: string | null
          referral_id?: string | null
          status?: string
          subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_commissions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_goals: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          id: string
          reward_type: string
          reward_value_cents: number
          sales_count: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          reward_type: string
          reward_value_cents?: number
          sales_count: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          reward_type?: string
          reward_value_cents?: number
          sales_count?: number
        }
        Relationships: []
      }
      affiliate_notifications: {
        Row: {
          affiliate_id: string
          body: string | null
          created_at: string
          id: string
          kind: string
          payload: Json | null
          read_at: string | null
          title: string
        }
        Insert: {
          affiliate_id: string
          body?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json | null
          read_at?: string | null
          title: string
        }
        Update: {
          affiliate_id?: string
          body?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json | null
          read_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_notifications_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_payouts: {
        Row: {
          admin_note: string | null
          affiliate_id: string
          amount_cents: number
          approved_at: string | null
          created_at: string
          id: string
          method: string
          paid_at: string | null
          payload: Json | null
          requested_at: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          affiliate_id: string
          amount_cents: number
          approved_at?: string | null
          created_at?: string
          id?: string
          method?: string
          paid_at?: string | null
          payload?: Json | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          affiliate_id?: string
          amount_cents?: number
          approved_at?: string | null
          created_at?: string
          id?: string
          method?: string
          paid_at?: string | null
          payload?: Json | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_settings: {
        Row: {
          commission_pct_annual: number
          commission_pct_lifetime: number
          commission_pct_monthly: number
          commission_pct_quarterly: number
          commission_pct_semiannual: number
          cookie_days: number
          hold_days: number
          id: number
          min_payout_cents: number
          payout_methods: Json
          updated_at: string
        }
        Insert: {
          commission_pct_annual?: number
          commission_pct_lifetime?: number
          commission_pct_monthly?: number
          commission_pct_quarterly?: number
          commission_pct_semiannual?: number
          cookie_days?: number
          hold_days?: number
          id?: number
          min_payout_cents?: number
          payout_methods?: Json
          updated_at?: string
        }
        Update: {
          commission_pct_annual?: number
          commission_pct_lifetime?: number
          commission_pct_monthly?: number
          commission_pct_quarterly?: number
          commission_pct_semiannual?: number
          cookie_days?: number
          hold_days?: number
          id?: number
          min_payout_cents?: number
          payout_methods?: Json
          updated_at?: string
        }
        Relationships: []
      }
      affiliates: {
        Row: {
          admin_note: string | null
          code: string
          coupon_code: string | null
          created_at: string
          custom_commission_pct: number | null
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          code: string
          coupon_code?: string | null
          created_at?: string
          custom_commission_pct?: number | null
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          code?: string
          coupon_code?: string | null
          created_at?: string
          custom_commission_pct?: number | null
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_proactive_log: {
        Row: {
          id: string
          insight_type: string
          message: string
          payload: Json
          responded: boolean
          sent_at: string
          user_id: string
        }
        Insert: {
          id?: string
          insight_type: string
          message: string
          payload?: Json
          responded?: boolean
          sent_at?: string
          user_id: string
        }
        Update: {
          id?: string
          insight_type?: string
          message?: string
          payload?: Json
          responded?: boolean
          sent_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_settings: {
        Row: {
          api_key: string | null
          enabled: boolean
          guest_message: string | null
          id: number
          last_used_at: string | null
          master_prompt: string | null
          model: string
          signup_done_message: string | null
          tone: string
          updated_at: string
          updated_by: string | null
          welcome_message: string | null
        }
        Insert: {
          api_key?: string | null
          enabled?: boolean
          guest_message?: string | null
          id: number
          last_used_at?: string | null
          master_prompt?: string | null
          model?: string
          signup_done_message?: string | null
          tone?: string
          updated_at?: string
          updated_by?: string | null
          welcome_message?: string | null
        }
        Update: {
          api_key?: string | null
          enabled?: boolean
          guest_message?: string | null
          id?: number
          last_used_at?: string | null
          master_prompt?: string | null
          model?: string
          signup_done_message?: string | null
          tone?: string
          updated_at?: string
          updated_by?: string | null
          welcome_message?: string | null
        }
        Relationships: []
      }
      appointment_reminders: {
        Row: {
          appointment_id: string
          attempts: number
          created_at: string
          id: string
          kind: string
          last_error: string | null
          scheduled_for: string
          sent_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_id: string
          attempts?: number
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          scheduled_for: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_id?: string
          attempts?: number
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          scheduled_for?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_reminders_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          ai_confidence: number | null
          category: string | null
          created_at: string
          id: string
          is_demo: boolean
          notes: string | null
          priority: string | null
          scheduled_at: string
          source: string
          source_text: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_confidence?: number | null
          category?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          priority?: string | null
          scheduled_at: string
          source?: string
          source_text?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_confidence?: number | null
          category?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          priority?: string | null
          scheduled_at?: string
          source?: string
          source_text?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          amount: number
          as_of: string
          created_at: string
          id: string
          kind: string
          label: string
          notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          as_of?: string
          created_at?: string
          id?: string
          kind?: string
          label: string
          notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          as_of?: string
          created_at?: string
          id?: string
          kind?: string
          label?: string
          notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_corrections: {
        Row: {
          action: string
          after_data: Json | null
          amount_after: number | null
          amount_before: number | null
          before_data: Json | null
          created_at: string
          id: string
          origin: string
          reason: string | null
          transaction_id: string
          user_id: string
        }
        Insert: {
          action: string
          after_data?: Json | null
          amount_after?: number | null
          amount_before?: number | null
          before_data?: Json | null
          created_at?: string
          id?: string
          origin?: string
          reason?: string | null
          transaction_id: string
          user_id: string
        }
        Update: {
          action?: string
          after_data?: Json | null
          amount_after?: number | null
          amount_before?: number | null
          before_data?: Json | null
          created_at?: string
          id?: string
          origin?: string
          reason?: string | null
          transaction_id?: string
          user_id?: string
        }
        Relationships: []
      }
      bill_payments: {
        Row: {
          amount: number
          bill_id: string
          created_at: string
          cycle_due_at: string
          id: string
          notes: string | null
          paid_at: string
          source: string
          transaction_id: string | null
          user_id: string
          was_full_payment: boolean
        }
        Insert: {
          amount: number
          bill_id: string
          created_at?: string
          cycle_due_at: string
          id?: string
          notes?: string | null
          paid_at?: string
          source?: string
          transaction_id?: string | null
          user_id: string
          was_full_payment?: boolean
        }
        Update: {
          amount?: number
          bill_id?: string
          created_at?: string
          cycle_due_at?: string
          id?: string
          notes?: string | null
          paid_at?: string
          source?: string
          transaction_id?: string | null
          user_id?: string
          was_full_payment?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "bill_payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "recurring_bills"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          id: string
          notified_100: boolean
          notified_80: boolean
          notified_90: boolean
          period: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          id?: string
          notified_100?: boolean
          notified_80?: boolean
          notified_90?: boolean
          period: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          id?: string
          notified_100?: boolean
          notified_80?: boolean
          notified_90?: boolean
          period?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          affiliate_id: string | null
          code: string
          created_at: string
          discount_type: string
          discount_value: number
          id: string
          max_uses: number | null
          uses: number
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          affiliate_id?: string | null
          code: string
          created_at?: string
          discount_type?: string
          discount_value: number
          id?: string
          max_uses?: number | null
          uses?: number
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          affiliate_id?: string | null
          code?: string
          created_at?: string
          discount_type?: string
          discount_value?: number
          id?: string
          max_uses?: number | null
          uses?: number
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          created_at: string
          creditor: string | null
          due_at: string | null
          id: string
          interest_rate: number
          last_notified_at: string | null
          notes: string | null
          notify_whatsapp: boolean
          paid: boolean
          principal: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          creditor?: string | null
          due_at?: string | null
          id?: string
          interest_rate?: number
          last_notified_at?: string | null
          notes?: string | null
          notify_whatsapp?: boolean
          paid?: boolean
          principal: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          creditor?: string | null
          due_at?: string | null
          id?: string
          interest_rate?: number
          last_notified_at?: string | null
          notes?: string | null
          notify_whatsapp?: boolean
          paid?: boolean
          principal?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_reconciliation_log: {
        Row: {
          channel: string
          consistent: boolean
          created_at: string
          details: Json
          diff: number
          id: string
          ledger_balance: number
          reported_balance: number
          user_id: string
        }
        Insert: {
          channel: string
          consistent: boolean
          created_at?: string
          details?: Json
          diff: number
          id?: string
          ledger_balance: number
          reported_balance: number
          user_id: string
        }
        Update: {
          channel?: string
          consistent?: boolean
          created_at?: string
          details?: Json
          diff?: number
          id?: string
          ledger_balance?: number
          reported_balance?: number
          user_id?: string
        }
        Relationships: []
      }
      financial_goals: {
        Row: {
          created_at: string
          current_amount: number
          id: string
          is_demo: boolean
          kind: string
          notes: string | null
          target_amount: number
          target_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_amount?: number
          id?: string
          is_demo?: boolean
          kind?: string
          notes?: string | null
          target_amount: number
          target_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_amount?: number
          id?: string
          is_demo?: boolean
          kind?: string
          notes?: string | null
          target_amount?: number
          target_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_goals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_achievements: {
        Row: {
          code: string
          habit_id: string | null
          id: string
          unlocked_at: string
          user_id: string
        }
        Insert: {
          code: string
          habit_id?: string | null
          id?: string
          unlocked_at?: string
          user_id: string
        }
        Update: {
          code?: string
          habit_id?: string | null
          id?: string
          unlocked_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_achievements_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_goals: {
        Row: {
          achieved_at: string | null
          created_at: string
          habit_id: string
          id: string
          period: string
          period_end: string
          period_start: string
          target_count: number
          user_id: string
        }
        Insert: {
          achieved_at?: string | null
          created_at?: string
          habit_id: string
          id?: string
          period: string
          period_end: string
          period_start: string
          target_count: number
          user_id: string
        }
        Update: {
          achieved_at?: string | null
          created_at?: string
          habit_id?: string
          id?: string
          period?: string
          period_end?: string
          period_start?: string
          target_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_goals_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habit_logs: {
        Row: {
          habit_id: string
          id: string
          log_date: string
          logged_at: string
          note: string | null
          source: string
          status: string
          user_id: string
        }
        Insert: {
          habit_id: string
          id?: string
          log_date: string
          logged_at?: string
          note?: string | null
          source?: string
          status?: string
          user_id: string
        }
        Update: {
          habit_id?: string
          id?: string
          log_date?: string
          logged_at?: string
          note?: string | null
          source?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_fkey"
            columns: ["habit_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id"]
          },
        ]
      }
      habits: {
        Row: {
          archived: boolean
          category: string | null
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          notes: string | null
          reminder_enabled: boolean
          target_daily: number
          target_monthly: number | null
          target_weekly: number | null
          time: string | null
          updated_at: string
          user_id: string
          weekdays: number[]
        }
        Insert: {
          archived?: boolean
          category?: string | null
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          notes?: string | null
          reminder_enabled?: boolean
          target_daily?: number
          target_monthly?: number | null
          target_weekly?: number | null
          time?: string | null
          updated_at?: string
          user_id: string
          weekdays?: number[]
        }
        Update: {
          archived?: boolean
          category?: string | null
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          notes?: string | null
          reminder_enabled?: boolean
          target_daily?: number
          target_monthly?: number | null
          target_weekly?: number | null
          time?: string | null
          updated_at?: string
          user_id?: string
          weekdays?: number[]
        }
        Relationships: []
      }
      import_batches: {
        Row: {
          created_at: string
          error_count: number
          file_name: string | null
          id: string
          imported_count: number
          notes: string | null
          skipped_count: number
          source_kind: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          notes?: string | null
          skipped_count?: number
          source_kind?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          notes?: string | null
          skipped_count?: number
          source_kind?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_purchases: {
        Row: {
          active: boolean
          category: string
          created_at: string
          first_due_at: string
          id: string
          installments_paid: number
          installments_total: number
          notes: string | null
          notify_whatsapp: boolean
          purchased_at: string
          reminder_offsets: number[]
          title: string
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          first_due_at: string
          id?: string
          installments_paid?: number
          installments_total: number
          notes?: string | null
          notify_whatsapp?: boolean
          purchased_at?: string
          reminder_offsets?: number[]
          title: string
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          first_due_at?: string
          id?: string
          installments_paid?: number
          installments_total?: number
          notes?: string | null
          notify_whatsapp?: boolean
          purchased_at?: string
          reminder_offsets?: number[]
          title?: string
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_purchases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_reminder_log: {
        Row: {
          due_at: string
          id: string
          installment_number: number
          offset_days: number
          purchase_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          due_at: string
          id?: string
          installment_number: number
          offset_days: number
          purchase_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          due_at?: string
          id?: string
          installment_number?: number
          offset_days?: number
          purchase_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_reminder_log_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "installment_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          answers: Json
          completed_at: string | null
          created_at: string
          current_step: string
          invited_at: string
          last_prompt_at: string | null
          reminder_sent_at: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          completed_at?: string | null
          created_at?: string
          current_step?: string
          invited_at?: string
          last_prompt_at?: string | null
          reminder_sent_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          completed_at?: string | null
          created_at?: string
          current_step?: string
          invited_at?: string
          last_prompt_at?: string | null
          reminder_sent_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      password_recovery_log: {
        Row: {
          created_at: string
          details: Json
          email: string | null
          error: string | null
          id: string
          identifier: string
          method: string
          ok: boolean
          phone: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          details?: Json
          email?: string | null
          error?: string | null
          id?: string
          identifier: string
          method: string
          ok?: boolean
          phone?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          details?: Json
          email?: string | null
          error?: string | null
          id?: string
          identifier?: string
          method?: string
          ok?: boolean
          phone?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      plans: {
        Row: {
          active: boolean
          created_at: string
          duration_days: number | null
          id: string
          name: string
          period: string
          price_cents: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          duration_days?: number | null
          id?: string
          name: string
          period: string
          price_cents?: number
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          duration_days?: number | null
          id?: string
          name?: string
          period?: string
          price_cents?: number
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          blocked_at: string | null
          created_at: string
          email: string | null
          freedom_goal_amount: number | null
          gender: string | null
          id: string
          last_seen_at: string | null
          name: string
          notify_email: boolean
          notify_whatsapp: boolean
          phone: string
          plan: string
          reengagement_enabled: boolean
          reengagement_last_sent_at: string | null
          reengagement_last_template: number | null
          status: string
          trial_ends_at: string
          updated_at: string
          weekly_summary_enabled: boolean
          welcome_sent_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          blocked_at?: string | null
          created_at?: string
          email?: string | null
          freedom_goal_amount?: number | null
          gender?: string | null
          id: string
          last_seen_at?: string | null
          name?: string
          notify_email?: boolean
          notify_whatsapp?: boolean
          phone: string
          plan?: string
          reengagement_enabled?: boolean
          reengagement_last_sent_at?: string | null
          reengagement_last_template?: number | null
          status?: string
          trial_ends_at?: string
          updated_at?: string
          weekly_summary_enabled?: boolean
          welcome_sent_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          blocked_at?: string | null
          created_at?: string
          email?: string | null
          freedom_goal_amount?: number | null
          gender?: string | null
          id?: string
          last_seen_at?: string | null
          name?: string
          notify_email?: boolean
          notify_whatsapp?: boolean
          phone?: string
          plan?: string
          reengagement_enabled?: boolean
          reengagement_last_sent_at?: string | null
          reengagement_last_template?: number | null
          status?: string
          trial_ends_at?: string
          updated_at?: string
          weekly_summary_enabled?: boolean
          welcome_sent_at?: string | null
        }
        Relationships: []
      }
      recurring_bills: {
        Row: {
          active: boolean
          amount: number
          awaiting_for: string | null
          category: string
          confirmation_sent_at: string | null
          created_at: string
          first_due_date: string | null
          frequency: string
          id: string
          is_demo: boolean
          last_charged_at: string | null
          last_notified_at: string | null
          last_paid_at: string | null
          last_paid_due: string | null
          last_reminder_sent_at: string | null
          next_due_at: string
          notes: string | null
          notified_1d_for: string | null
          notified_3d_for: string | null
          notify_whatsapp: boolean
          original_amount: number | null
          paid_amount: number
          paid_installments: number
          payment_day: number | null
          payment_status: string
          remaining_installments: number | null
          title: string
          total_installments: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          amount: number
          awaiting_for?: string | null
          category?: string
          confirmation_sent_at?: string | null
          created_at?: string
          first_due_date?: string | null
          frequency?: string
          id?: string
          is_demo?: boolean
          last_charged_at?: string | null
          last_notified_at?: string | null
          last_paid_at?: string | null
          last_paid_due?: string | null
          last_reminder_sent_at?: string | null
          next_due_at: string
          notes?: string | null
          notified_1d_for?: string | null
          notified_3d_for?: string | null
          notify_whatsapp?: boolean
          original_amount?: number | null
          paid_amount?: number
          paid_installments?: number
          payment_day?: number | null
          payment_status?: string
          remaining_installments?: number | null
          title: string
          total_installments?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          amount?: number
          awaiting_for?: string | null
          category?: string
          confirmation_sent_at?: string | null
          created_at?: string
          first_due_date?: string | null
          frequency?: string
          id?: string
          is_demo?: boolean
          last_charged_at?: string | null
          last_notified_at?: string | null
          last_paid_at?: string | null
          last_paid_due?: string | null
          last_reminder_sent_at?: string | null
          next_due_at?: string
          notes?: string | null
          notified_1d_for?: string | null
          notified_3d_for?: string | null
          notify_whatsapp?: boolean
          original_amount?: number | null
          paid_amount?: number
          paid_installments?: number
          payment_day?: number | null
          payment_status?: string
          remaining_installments?: number | null
          title?: string
          total_installments?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_bills_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          affiliate_id: string
          click_id: string | null
          created_at: string
          first_paid_at: string | null
          id: string
          source_campaign: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          affiliate_id: string
          click_id?: string | null
          created_at?: string
          first_paid_at?: string | null
          id?: string
          source_campaign?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          affiliate_id?: string
          click_id?: string | null
          created_at?: string
          first_paid_at?: string | null
          id?: string
          source_campaign?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_click_id_fkey"
            columns: ["click_id"]
            isOneToOne: false
            referencedRelation: "affiliate_clicks"
            referencedColumns: ["id"]
          },
        ]
      }
      reset_audit_logs: {
        Row: {
          created_at: string
          details: Json
          id: string
          ok: boolean
          reset_at: string
          total_removed: number
          user_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          ok?: boolean
          reset_at?: string
          total_removed?: number
          user_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          ok?: boolean
          reset_at?: string
          total_removed?: number
          user_id?: string
        }
        Relationships: []
      }
      salary_entries: {
        Row: {
          amount: number
          created_at: string
          id: string
          kind: string
          notes: string | null
          received_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          received_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          received_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "salary_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          admin_note: string | null
          cancelled_at: string | null
          created_at: string
          ends_at: string | null
          id: string
          period: string
          plan_name: string
          plan_slug: string
          price_cents: number
          started_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_note?: string | null
          cancelled_at?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          period: string
          plan_name: string
          plan_slug: string
          price_cents?: number
          started_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_note?: string | null
          cancelled_at?: string | null
          created_at?: string
          ends_at?: string | null
          id?: string
          period?: string
          plan_name?: string
          plan_slug?: string
          price_cents?: number
          started_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_slug_fkey"
            columns: ["plan_slug"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          admin_reply: string | null
          created_at: string
          id: string
          message: string
          status: string
          subject: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_reply?: string | null
          created_at?: string
          id?: string
          message: string
          status?: string
          subject: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_reply?: string | null
          created_at?: string
          id?: string
          message?: string
          status?: string
          subject?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      system_metrics: {
        Row: {
          created_at: string
          duration_ms: number
          error_code: string | null
          error_message: string | null
          fn_name: string
          id: string
          metadata: Json
          ok: boolean
          stage: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          duration_ms?: number
          error_code?: string | null
          error_message?: string | null
          fn_name: string
          id?: string
          metadata?: Json
          ok?: boolean
          stage?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          duration_ms?: number
          error_code?: string | null
          error_message?: string | null
          fn_name?: string
          id?: string
          metadata?: Json
          ok?: boolean
          stage?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      transaction_edits: {
        Row: {
          created_at: string
          field: string
          id: string
          new_value: Json | null
          old_value: Json | null
          source: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          field: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          source?: string
          transaction_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          field?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          source?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_edits_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_edits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          operation: string
          snapshot: Json
          source: string | null
          transaction_id: string
          user_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          operation: string
          snapshot: Json
          source?: string | null
          transaction_id: string
          user_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          operation?: string
          snapshot?: Json
          source?: string | null
          transaction_id?: string
          user_id?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          category: string
          channel: string | null
          created_at: string
          description: string | null
          id: string
          import_batch_id: string | null
          is_demo: boolean
          kind: Database["public"]["Enums"]["tx_kind"]
          occurred_at: string
          source: string
          source_id: string | null
          source_message_id: string | null
          source_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string
          channel?: string | null
          created_at?: string
          description?: string | null
          id?: string
          import_batch_id?: string | null
          is_demo?: boolean
          kind: Database["public"]["Enums"]["tx_kind"]
          occurred_at?: string
          source?: string
          source_id?: string | null
          source_message_id?: string | null
          source_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          channel?: string | null
          created_at?: string
          description?: string | null
          id?: string
          import_batch_id?: string | null
          is_demo?: boolean
          kind?: Database["public"]["Enums"]["tx_kind"]
          occurred_at?: string
          source?: string
          source_id?: string | null
          source_message_id?: string | null
          source_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_ai_learning: {
        Row: {
          corrected_field: string
          corrected_value: string | null
          created_at: string
          id: string
          original_text: string | null
          original_value: string | null
          source: string
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          corrected_field: string
          corrected_value?: string | null
          created_at?: string
          id?: string
          original_text?: string | null
          original_value?: string | null
          source?: string
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          corrected_field?: string
          corrected_value?: string | null
          created_at?: string
          id?: string
          original_text?: string | null
          original_value?: string | null
          source?: string
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      user_ai_profile: {
        Row: {
          avg_daily_expense: number | null
          avg_monthly_expense: number | null
          avg_weekly_expense: number | null
          category_stats: Json
          channel_counts: Json
          created_at: string
          frequent_places: Json
          fuel_typical_dow: number | null
          last_computed_at: string | null
          preferred_channel: string | null
          recurring_patterns: Json
          salary_typical_day: number | null
          typical_entry_hour: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avg_daily_expense?: number | null
          avg_monthly_expense?: number | null
          avg_weekly_expense?: number | null
          category_stats?: Json
          channel_counts?: Json
          created_at?: string
          frequent_places?: Json
          fuel_typical_dow?: number | null
          last_computed_at?: string | null
          preferred_channel?: string | null
          recurring_patterns?: Json
          salary_typical_day?: number | null
          typical_entry_hour?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avg_daily_expense?: number | null
          avg_monthly_expense?: number | null
          avg_weekly_expense?: number | null
          category_stats?: Json
          channel_counts?: Json
          created_at?: string
          frequent_places?: Json
          fuel_typical_dow?: number | null
          last_computed_at?: string | null
          preferred_channel?: string | null
          recurring_patterns?: Json
          salary_typical_day?: number | null
          typical_entry_hour?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wa_broadcasts: {
        Row: {
          caption: string | null
          contact_id: string | null
          content: string | null
          created_at: string
          error: string | null
          id: string
          image_url: string | null
          is_demo: boolean
          kind: string
          phone: string
          response: Json | null
          sent_by: string | null
          status: string
        }
        Insert: {
          caption?: string | null
          contact_id?: string | null
          content?: string | null
          created_at?: string
          error?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          kind?: string
          phone: string
          response?: Json | null
          sent_by?: string | null
          status?: string
        }
        Update: {
          caption?: string | null
          contact_id?: string | null
          content?: string | null
          created_at?: string
          error?: string | null
          id?: string
          image_url?: string | null
          is_demo?: boolean
          kind?: string
          phone?: string
          response?: Json | null
          sent_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "wa_broadcasts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "wa_contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contacts: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          last_query_context: Json | null
          last_reply_variant: Json
          name: string
          pending_action: Json | null
          phone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_query_context?: Json | null
          last_reply_variant?: Json
          name?: string
          pending_action?: Json | null
          phone: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          last_query_context?: Json | null
          last_reply_variant?: Json
          name?: string
          pending_action?: Json | null
          phone?: string
          updated_at?: string
        }
        Relationships: []
      }
      wa_conversation_context: {
        Row: {
          extra: Json
          last_amount: number | null
          last_category: string | null
          last_intent: string | null
          last_message_at: string | null
          last_transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          extra?: Json
          last_amount?: number | null
          last_category?: string | null
          last_intent?: string | null
          last_message_at?: string | null
          last_transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          extra?: Json
          last_amount?: number | null
          last_category?: string | null
          last_intent?: string | null
          last_message_at?: string | null
          last_transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wa_duplicate_log: {
        Row: {
          amount: number | null
          content: string | null
          created_at: string
          id: string
          kind: string | null
          matched_message_id: string | null
          matched_transaction_id: string | null
          phone: string
          raw_message_id: string | null
          reason: string
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          content?: string | null
          created_at?: string
          id?: string
          kind?: string | null
          matched_message_id?: string | null
          matched_transaction_id?: string | null
          phone: string
          raw_message_id?: string | null
          reason: string
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          content?: string | null
          created_at?: string
          id?: string
          kind?: string | null
          matched_message_id?: string | null
          matched_transaction_id?: string | null
          phone?: string
          raw_message_id?: string | null
          reason?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_duplicate_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_message_jobs: {
        Row: {
          ack_sent: boolean
          attempts: number
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          max_attempts: number
          message_id: string | null
          next_retry_at: string
          payload: Json
          stage: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          ack_sent?: boolean
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_id?: string | null
          next_retry_at?: string
          payload?: Json
          stage?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          ack_sent?: boolean
          attempts?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          message_id?: string | null
          next_retry_at?: string
          payload?: Json
          stage?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_message_jobs_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_templates: {
        Row: {
          body: string
          id: string
          key: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: string
          id?: string
          key: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          id?: string
          key?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      weekly_summary_log: {
        Row: {
          details: Json | null
          id: string
          ok: boolean
          phone: string | null
          sent_at: string
          user_id: string
          week_key: string
        }
        Insert: {
          details?: Json | null
          id?: string
          ok?: boolean
          phone?: string | null
          sent_at?: string
          user_id: string
          week_key: string
        }
        Update: {
          details?: Json | null
          id?: string
          ok?: boolean
          phone?: string | null
          sent_at?: string
          user_id?: string
          week_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_summary_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          ai_intent: string | null
          ai_meta: Json | null
          ai_payload: Json | null
          attempts: number
          content: string | null
          created_at: string
          direction: string
          id: string
          is_demo: boolean
          last_error: string | null
          media_type: string
          phone: string
          processed_at: string | null
          processing_started_at: string | null
          raw: Json | null
          raw_message_id: string | null
          response_ms: number | null
          status: string
          transcription: string | null
          user_id: string | null
        }
        Insert: {
          ai_intent?: string | null
          ai_meta?: Json | null
          ai_payload?: Json | null
          attempts?: number
          content?: string | null
          created_at?: string
          direction: string
          id?: string
          is_demo?: boolean
          last_error?: string | null
          media_type?: string
          phone: string
          processed_at?: string | null
          processing_started_at?: string | null
          raw?: Json | null
          raw_message_id?: string | null
          response_ms?: number | null
          status?: string
          transcription?: string | null
          user_id?: string | null
        }
        Update: {
          ai_intent?: string | null
          ai_meta?: Json | null
          ai_payload?: Json | null
          attempts?: number
          content?: string | null
          created_at?: string
          direction?: string
          id?: string
          is_demo?: boolean
          last_error?: string | null
          media_type?: string
          phone?: string
          processed_at?: string | null
          processing_started_at?: string | null
          raw?: Json | null
          raw_message_id?: string | null
          response_ms?: number | null
          status?: string
          transcription?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      zapi_credentials: {
        Row: {
          client_token: string
          created_at: string
          id: string
          instance_id: string
          instance_token: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          client_token: string
          created_at?: string
          id?: string
          instance_id: string
          instance_token: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          client_token?: string
          created_at?: string
          id?: string
          instance_id?: string
          instance_token?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_reset_user_data: { Args: { target: string }; Returns: Json }
      affiliate_mature_commissions: { Args: never; Returns: Json }
      audit_delete_transaction: {
        Args: { p_mode?: string; p_reason?: string; p_transaction_id: string }
        Returns: Json
      }
      audit_update_transaction: {
        Args: {
          p_amount: number
          p_category: string
          p_description: string
          p_kind: string
          p_occurred_at: string
          p_reason?: string
          p_transaction_id: string
        }
        Returns: Json
      }
      cleanup_ops_tables: { Args: never; Returns: undefined }
      finance_snapshot: {
        Args: { _from?: string; _to?: string; _user_id: string }
        Returns: Json
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      pay_installment_atomic: {
        Args: {
          p_channel?: string
          p_occurred_at?: string
          p_purchase_id: string
          p_user_id: string
        }
        Returns: Json
      }
      register_bill_payment_atomic: {
        Args: {
          p_amount: number
          p_bill_id: string
          p_notes?: string
          p_occurred_at: string
          p_source?: string
          p_user_id: string
        }
        Returns: Json
      }
      reset_my_data: { Args: never; Returns: Json }
      reverse_bill_payment_atomic: {
        Args: { p_payment_id: string; p_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      app_role: "admin" | "user"
      tx_kind: "income" | "expense"
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
    Enums: {
      app_role: ["admin", "user"],
      tx_kind: ["income", "expense"],
    },
  },
} as const
