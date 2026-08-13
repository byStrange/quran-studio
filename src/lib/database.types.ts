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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      daily_reading: {
        Row: {
          day: string
          seconds_read: number
          updated_at: string
          user_id: string
        }
        Insert: {
          day: string
          seconds_read?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          day?: string
          seconds_read?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      memorized_verses: {
        Row: {
          memorized_at: string
          user_id: string
          verse_id: number
        }
        Insert: {
          memorized_at?: string
          user_id: string
          verse_id: number
        }
        Update: {
          memorized_at?: string
          user_id?: string
          verse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "memorized_verses_verse_id_fkey"
            columns: ["verse_id"]
            isOneToOne: false
            referencedRelation: "quran_verses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          timezone: string
          ui_prefs: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          timezone?: string
          ui_prefs?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          timezone?: string
          ui_prefs?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      quiz_attempts: {
        Row: {
          answered_at: string
          correct: boolean
          id: number
          user_id: string
          word_id: number
        }
        Insert: {
          answered_at?: string
          correct: boolean
          id?: never
          user_id: string
          word_id: number
        }
        Update: {
          answered_at?: string
          correct?: boolean
          id?: never
          user_id?: string
          word_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "quran_words"
            referencedColumns: ["id"]
          },
        ]
      }
      quran_mushaf_glyphs: {
        Row: {
          char_type: string
          glyph: string
          id: number
          line_number: number
          page_number: number
          position: number
          verse_id: number
        }
        Insert: {
          char_type: string
          glyph: string
          id: number
          line_number: number
          page_number: number
          position: number
          verse_id: number
        }
        Update: {
          char_type?: string
          glyph?: string
          id?: number
          line_number?: number
          page_number?: number
          position?: number
          verse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "quran_mushaf_glyphs_verse_id_fkey"
            columns: ["verse_id"]
            isOneToOne: false
            referencedRelation: "quran_verses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quran_mushaf_glyphs_page_number_line_number_fkey"
            columns: ["page_number", "line_number"]
            isOneToOne: false
            referencedRelation: "quran_mushaf_lines"
            referencedColumns: ["page_number", "line_number"]
          },
        ]
      }
      quran_mushaf_lines: {
        Row: {
          is_centered: boolean
          line_number: number
          line_type: string
          page_number: number
          surah_number: number | null
        }
        Insert: {
          is_centered?: boolean
          line_number: number
          line_type: string
          page_number: number
          surah_number?: number | null
        }
        Update: {
          is_centered?: boolean
          line_number?: number
          line_type?: string
          page_number?: number
          surah_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "quran_mushaf_lines_surah_number_fkey"
            columns: ["surah_number"]
            isOneToOne: false
            referencedRelation: "quran_surahs"
            referencedColumns: ["number"]
          },
        ]
      }
      quran_rukus: {
        Row: {
          ayah_end: number
          ayah_start: number
          page_end: number | null
          page_start: number | null
          ruku_in_surah: number
          ruku_number: number
          surah_number: number
          verse_count: number
        }
        Insert: {
          ayah_end: number
          ayah_start: number
          page_end?: number | null
          page_start?: number | null
          ruku_in_surah: number
          ruku_number: number
          surah_number: number
          verse_count: number
        }
        Update: {
          ayah_end?: number
          ayah_start?: number
          page_end?: number | null
          page_start?: number | null
          ruku_in_surah?: number
          ruku_number?: number
          surah_number?: number
          verse_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "quran_rukus_surah_number_fkey"
            columns: ["surah_number"]
            isOneToOne: false
            referencedRelation: "quran_surahs"
            referencedColumns: ["number"]
          },
        ]
      }
      quran_surahs: {
        Row: {
          ayah_count: number
          name_arabic: string
          name_english: string
          name_translation: string
          number: number
          revelation_type: string
          ruku_count: number
        }
        Insert: {
          ayah_count: number
          name_arabic: string
          name_english: string
          name_translation: string
          number: number
          revelation_type: string
          ruku_count?: number
        }
        Update: {
          ayah_count?: number
          name_arabic?: string
          name_english?: string
          name_translation?: string
          number?: number
          revelation_type?: string
          ruku_count?: number
        }
        Relationships: []
      }
      quran_verses: {
        Row: {
          arabic_text: string
          audio_url: string | null
          ayah_number: number
          id: number
          juz_number: number
          page_number: number | null
          ruku_number: number
          surah_number: number
          tajweed: Json | null
          translation_en: string
        }
        Insert: {
          arabic_text: string
          audio_url?: string | null
          ayah_number: number
          id: number
          juz_number: number
          page_number?: number | null
          ruku_number: number
          surah_number: number
          tajweed?: Json | null
          translation_en: string
        }
        Update: {
          arabic_text?: string
          audio_url?: string | null
          ayah_number?: number
          id?: number
          juz_number?: number
          page_number?: number | null
          ruku_number?: number
          surah_number?: number
          tajweed?: Json | null
          translation_en?: string
        }
        Relationships: [
          {
            foreignKeyName: "quran_verses_surah_number_fkey"
            columns: ["surah_number"]
            isOneToOne: false
            referencedRelation: "quran_surahs"
            referencedColumns: ["number"]
          },
        ]
      }
      quran_words: {
        Row: {
          arabic: string
          gloss_en: string | null
          id: number
          position: number
          transliteration: string | null
          verse_id: number
        }
        Insert: {
          arabic: string
          gloss_en?: string | null
          id: number
          position: number
          transliteration?: string | null
          verse_id: number
        }
        Update: {
          arabic?: string
          gloss_en?: string | null
          id?: number
          position?: number
          transliteration?: string | null
          verse_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "quran_words_verse_id_fkey"
            columns: ["verse_id"]
            isOneToOne: false
            referencedRelation: "quran_verses"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_sessions: {
        Row: {
          created_at: string
          ended_at: string
          id: number
          ruku_number: number | null
          seconds: number
          started_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at: string
          id?: never
          ruku_number?: number | null
          seconds: number
          started_at: string
          user_id: string
        }
        Update: {
          created_at?: string
          ended_at?: string
          id?: never
          ruku_number?: number | null
          seconds?: number
          started_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ruku_ai_summary: {
        Row: {
          generated_at: string
          model_used: string
          ruku_number: number
          summary: string
        }
        Insert: {
          generated_at?: string
          model_used: string
          ruku_number: number
          summary: string
        }
        Update: {
          generated_at?: string
          model_used?: string
          ruku_number?: number
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "ruku_ai_summary_ruku_number_fkey"
            columns: ["ruku_number"]
            isOneToOne: true
            referencedRelation: "quran_rukus"
            referencedColumns: ["ruku_number"]
          },
        ]
      }
      streak_state: {
        Row: {
          computed_at: string
          current_streak: number
          grace_expires_on: string | null
          grace_started_on: string | null
          last_counted_date: string | null
          longest_streak: number
          user_id: string
        }
        Insert: {
          computed_at?: string
          current_streak?: number
          grace_expires_on?: string | null
          grace_started_on?: string | null
          last_counted_date?: string | null
          longest_streak?: number
          user_id: string
        }
        Update: {
          computed_at?: string
          current_streak?: number
          grace_expires_on?: string | null
          grace_started_on?: string | null
          last_counted_date?: string | null
          longest_streak?: number
          user_id?: string
        }
        Relationships: []
      }
      tafsir_ibn_kathir: {
        Row: {
          ayah_end: number
          ayah_start: number
          content: string
          id: number
          surah_number: number
        }
        Insert: {
          ayah_end: number
          ayah_start: number
          content: string
          id?: never
          surah_number: number
        }
        Update: {
          ayah_end?: number
          ayah_start?: number
          content?: string
          id?: never
          surah_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "tafsir_ibn_kathir_surah_number_fkey"
            columns: ["surah_number"]
            isOneToOne: false
            referencedRelation: "quran_surahs"
            referencedColumns: ["number"]
          },
        ]
      }
      user_word_progress: {
        Row: {
          correct_count: number
          created_at: string
          last_reviewed_at: string | null
          review_count: number
          status: Database["public"]["Enums"]["word_status"]
          updated_at: string
          user_id: string
          word_id: number
        }
        Insert: {
          correct_count?: number
          created_at?: string
          last_reviewed_at?: string | null
          review_count?: number
          status?: Database["public"]["Enums"]["word_status"]
          updated_at?: string
          user_id: string
          word_id: number
        }
        Update: {
          correct_count?: number
          created_at?: string
          last_reviewed_at?: string | null
          review_count?: number
          status?: Database["public"]["Enums"]["word_status"]
          updated_at?: string
          user_id?: string
          word_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_word_progress_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "quran_words"
            referencedColumns: ["id"]
          },
        ]
      }
      word_ai_context: {
        Row: {
          explanation: string
          generated_at: string
          model_used: string
          word_id: number
        }
        Insert: {
          explanation: string
          generated_at?: string
          model_used: string
          word_id: number
        }
        Update: {
          explanation?: string
          generated_at?: string
          model_used?: string
          word_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "word_ai_context_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: true
            referencedRelation: "quran_words"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_streak: {
        Args: never
        Returns: {
          computed_at: string
          current_streak: number
          grace_expires_on: string | null
          grace_started_on: string | null
          last_counted_date: string | null
          longest_streak: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "streak_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      log_reading: {
        Args: {
          p_ruku_number?: number
          p_seconds: number
          p_started_at?: string
        }
        Returns: {
          computed_at: string
          current_streak: number
          grace_expires_on: string | null
          grace_started_on: string | null
          last_counted_date: string | null
          longest_streak: number
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "streak_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      memorization_overview: { Args: never; Returns: Json }
      memorized_by_surah: {
        Args: never
        Returns: {
          ayah_count: number
          memorized_count: number
          surah_number: number
        }[]
      }
      quiz_distractors: {
        Args: { p_exclude: string[]; p_limit?: number }
        Returns: {
          gloss_en: string
        }[]
      }
      quiz_pool: {
        Args: { p_limit?: number }
        Returns: {
          arabic: string
          ayah_number: number
          gloss_en: string
          status: Database["public"]["Enums"]["word_status"]
          surah_number: number
          transliteration: string
          word_id: number
        }[]
      }
      reading_overview: { Args: never; Returns: Json }
      recompute_streak: { Args: { p_user_id: string }; Returns: undefined }
      vocabulary_overview: { Args: never; Returns: Json }
    }
    Enums: {
      word_status: "new" | "learning" | "learned"
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
      word_status: ["new", "learning", "learned"],
    },
  },
} as const
