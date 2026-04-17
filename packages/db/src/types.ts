/**
 * @file types.ts
 * @module db/types
 *
 * Typed database definitions for the ClaimClarity public schema.
 *
 * DEPENDENCIES:
 *   - @supabase/supabase-js (SupabaseClient generic)
 *
 * CALLED BY:
 *   - /packages/db/src/client.browser.ts
 *   - /packages/db/src/client.server.ts
 *   - /apps/processor/src/health.ts
 *
 * CALLS:
 *   - none
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type TableDefinition<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      users: TableDefinition<{
        id: string
        email: string
        phone: string | null
        role: 'patient' | 'reviewer' | 'expert' | 'admin'
        full_name: string | null
        city_tier: 'tier1' | 'tier2' | 'tier3' | null
        created_at: string | null
        last_active_at: string | null
      }>
      partners: TableDefinition<{
        id: string
        name: string
        partner_type: 'broker' | 'ifa' | 'hr_team' | 'other'
        contact_email: string
        referral_code: string | null
        status: 'active' | 'paused' | 'suspended'
        created_at: string | null
        created_by: string | null
      }>
      consents: TableDefinition<{
        id: string
        user_id: string
        case_id: string | null
        consent_type:
          | 'data_processing'
          | 'no_training'
          | 'retention_policy'
          | 'informational_only'
          | 'terms_of_service'
        consent_given: boolean
        privacy_policy_version: string
        terms_version: string
        source_channel: 'patient_web' | 'admin_created' | null
        ip_address: string | null
        user_agent: string | null
        revoked_at: string | null
        revocation_reason: string | null
        created_at: string | null
      }>
      cases: TableDefinition<{
        id: string
        patient_id: string
        partner_id: string | null
        case_ref: string
        intake_channel: 'patient_web' | 'admin_created'
        status:
          | 'consent_pending'
          | 'documents_pending'
          | 'payment_pending'
          | 'processing'
          | 'ai_draft_ready'
          | 'under_review'
          | 'escalated'
          | 'approved'
          | 'generating_report'
          | 'delivered'
          | 'closed'
        current_step:
          | 'quality_check'
          | 'ocr'
          | 'rules_engine'
          | 'ai_draft'
          | 'awaiting_review'
          | 'report_generation'
          | 'complete'
          | 'failed'
          | null
        claim_amount_inr: number | null
        insurer_name: string | null
        procedure_category: string | null
        case_type: 'cashless' | 'reimbursement' | null
        assigned_reviewer_id: string | null
        assigned_expert_id: string | null
        ai_draft: Json | null
        confidence_overall: 'high' | 'low' | 'mixed' | null
        sla_deadline: string | null
        sla_breached: boolean | null
        sla_warning_sent: boolean | null
        is_partial_report: boolean | null
        partial_reason: string | null
        generation_failed: boolean | null
        generation_failure_reason: string | null
        payment_waived: boolean
        payment_waived_reason: string | null
        payment_mode: 'real_payment' | 'admin_waived' | 'internal_access_code' | 'test_simulated'
        payment_reporting_category: 'paid' | 'waived' | 'test'
        original_approved_inr: number | null
        originally_deducted_inr: number | null
        created_at: string | null
        updated_at: string | null
      }>
      documents: TableDefinition<{
        id: string
        case_id: string
        doc_type: string
        is_required: boolean | null
        storage_path: string
        original_filename_encrypted: string | null
        file_size_bytes: number | null
        mime_type: string | null
        page_count: number | null
        quality_status: 'pending' | 'pass' | 'fail' | 'manual_required' | null
        quality_failure_reason: string | null
        quality_checked_at: string | null
        ocr_status: 'pending' | 'running' | 'completed' | 'failed' | null
        ocr_started_at: string | null
        ocr_completed_at: string | null
        ocr_attempt_count: number | null
        extracted_json: Json | null
        extracted_text: string | null
        extraction_confidence: number | null
        language_detected: string | null
        has_tables: boolean | null
        has_handwriting: boolean | null
        uploaded_at: string | null
        uploaded_by: string | null
      }>
      findings: TableDefinition<{
        id: string
        case_id: string
        finding_type: string
        bill_line_item: string | null
        bill_amount_inr: number | null
        bill_category: string | null
        clause_reference: string | null
        clause_text: string | null
        kb_pattern_id: string | null
        operative_reason: string | null
        plain_language_explanation: string | null
        confidence_label:
          | 'clause_found_matched'
          | 'based_on_typical_policy'
          | 'insufficient_information'
        appeal_strength: 'strong' | 'moderate' | 'weak' | null
        appeal_basis: string | null
        ai_generated: boolean | null
        reviewer_confirmed: boolean | null
        reviewer_confirmed_by: string | null
        reviewer_confirmed_at: string | null
        reviewer_unassessable: boolean | null
        reviewer_unassessable_reason: string | null
        reviewer_unassessable_by: string | null
        reviewer_unassessable_at: string | null
        reviewer_edited: boolean | null
        expert_confirmed: boolean | null
        expert_confirmed_by: string | null
        sort_order: number | null
        created_at: string | null
        updated_at: string | null
      }>
      escalations: TableDefinition<{
        id: string
        case_id: string
        finding_id: string | null
        escalation_type: 'finding' | 'full_case'
        from_reviewer_id: string
        to_expert_id: string | null
        question_text: string
        priority: 'normal' | 'high'
        status: 'open' | 'accepted' | 'responded' | 'resolved' | 'dismissed'
        expert_response: string | null
        confidence_recommendation:
          | 'clause_found_matched'
          | 'based_on_typical_policy'
          | 'insufficient_information'
          | null
        clause_reference_from_expert: string | null
        created_at: string | null
        accepted_at: string | null
        responded_at: string | null
        resolved_at: string | null
      }>
      processing_jobs: TableDefinition<{
        id: string
        case_id: string
        document_id: string | null
        job_type: string
        status: 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled'
        attempt_count: number | null
        max_attempts: number | null
        payload: Json | null
        result: Json | null
        error_message: string | null
        queued_at: string | null
        started_at: string | null
        completed_at: string | null
        next_retry_at: string | null
        idempotency_key: string | null
      }>
      kb_clause_patterns: TableDefinition<{
        id: string
        insurer_name: string | null
        clause_category: string
        clause_keywords: string[]
        typical_clause_text: string | null
        common_deduction_trigger: string
        operative_reason_template: string
        plain_language_template: string
        appeal_point_template: string
        precedent_ombudsman_ref: string | null
        is_active: boolean | null
        verified_by_expert: boolean | null
        verified_by: string | null
        verified_at: string | null
        added_by: string
        created_at: string | null
        updated_at: string | null
      }>
      kb_change_log: TableDefinition<{
        id: string
        pattern_id: string
        changed_by: string
        change_type: 'created' | 'updated' | 'verified' | 'deactivated'
        old_values: Json | null
        new_values: Json | null
        change_reason: string | null
        changed_at: string | null
      }>
      reports: TableDefinition<{
        id: string
        case_id: string
        report_version: number | null
        is_partial: boolean | null
        partial_reason: string | null
        pdf_storage_path: string | null
        appeal_letter_included: boolean | null
        signed_off_by: string | null
        signed_off_at: string | null
        delivered_at: string | null
        delivery_email_id: string | null
        correction_of_version: number | null
        correction_reason: string | null
        created_at: string | null
      }>
      quality_scores: TableDefinition<{
        id: string
        case_id: string
        report_id: string | null
        scored_by: string
        scoring_type: 'post_delivery_expert_review' | 'calibration_check'
        clause_extraction_accuracy: number | null
        deduction_reason_accuracy: number | null
        missing_doc_identification: number | null
        next_step_question_usefulness: number | null
        appeal_point_validity: number | null
        harmful_output: boolean | null
        harmful_output_description: string | null
        notes: string | null
        scored_at: string | null
      }>
      outcomes: TableDefinition<{
        id: string
        case_id: string
        appeal_submitted: boolean | null
        appeal_submitted_at: string | null
        insurer_responded: boolean | null
        insurer_responded_at: string | null
        final_settled_amount_inr: number | null
        original_approved_inr: number | null
        originally_deducted_inr: number | null
        reversal_amount_inr: number | null
        outcome_type:
          | 'full_reversal'
          | 'partial_reversal'
          | 'no_change'
          | 'pending'
          | 'not_applicable'
          | null
        report_used_in_appeal: boolean | null
        evidence_type: 'self_reported' | 'partially_verified' | 'document_verified'
        evidence_storage_path: string | null
        evidence_notes: string | null
        insurer_reply_summary: string | null
        patient_satisfaction: number | null
        follow_up_status: string | null
        created_at: string | null
        updated_at: string | null
      }>
      outcome_tokens: TableDefinition<{
        id: string
        case_id: string
        token_hash: string
        action_type: string
        expires_at: string
        used_at: string | null
        created_at: string | null
      }>
      follow_up_schedule: TableDefinition<{
        id: string
        case_id: string
        sequence_number: 1 | 2 | 3
        scheduled_at: string
        sent_at: string | null
        email_message_id: string | null
        response_received: boolean | null
      }>
      payments: TableDefinition<{
        id: string
        case_id: string
        patient_id: string
        amount_inr: number
        payment_type: 'report' | 'expert_call' | 'correction'
        razorpay_order_id: string | null
        razorpay_payment_id: string | null
        razorpay_signature: string | null
        status: 'pending' | 'paid' | 'refunded' | 'partial_refund' | 'failed' | 'cancelled'
        paid_at: string | null
        refunded_at: string | null
        refund_amount_inr: number | null
        refund_reason: string | null
        refund_razorpay_id: string | null
        created_at: string | null
      }>
      reviewer_notifications: TableDefinition<{
        id: string
        recipient_id: string
        notification_type: string
        case_id: string | null
        escalation_id: string | null
        message: string
        read_at: string | null
        created_at: string | null
      }>
      audit_log: TableDefinition<{
        id: string
        actor_id: string | null
        actor_role: string | null
        action: string
        entity_type: string | null
        entity_id: string | null
        ip_address: string | null
        metadata: Json | null
        created_at: string | null
      }>
    }
    Views: Record<string, never>
    Functions: {
      verify_sequence_exists: {
        Args: { seq_name: string }
        Returns: boolean
      }
      verify_generated_column: {
        Args: { tbl: string; col: string }
        Returns: boolean
      }
        verify_rls_enabled: {
          Args: { tbl: string }
          Returns: boolean
        }
        next_case_ref_seq: {
          Args: Record<string, never>
          Returns: number
        }
      }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export type DbClient = SupabaseClient<Database>
