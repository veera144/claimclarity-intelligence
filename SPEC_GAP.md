# SPEC GAP

## Exact conflict

Module 4 requires the Textract client to fetch documents from Supabase Storage using a 5-minute service-role signed URL, then use AWS Textract `StartDocumentAnalysis` with polling for multi-page PDFs.

The installed `@aws-sdk/client-textract` types show `StartDocumentAnalysis` accepts `DocumentLocation` with an `S3Object` only. It does not accept raw bytes or an HTTPS signed URL. The sync `AnalyzeDocument` byte path is also typed for image bytes, while Module 4 calls for small PDFs to be handled through the signed-URL fetch path.

Implementing this exactly would require an additional S3 staging/mirroring step or a spec change that limits supported sync input to formats Textract accepts from bytes. Neither step is specified in `MASTER_SPEC.md`.

## Affected module

Module 4 - OCR AND EXTRACTION PIPELINE

## Recommended resolution

Choose one of these explicit approaches in `MASTER_SPEC.md` before Module 4 proceeds:

1. Add a Module 4 S3 staging step: download the Supabase Storage object, upload it to an AWS S3 bucket in `ap-south-1`, then pass that S3 object to Textract async APIs for PDFs and multi-page documents.
2. Store case documents directly in an AWS S3 bucket accessible to Textract, and save the S3 bucket/key alongside the Supabase document record.
3. Restrict Module 4 OCR to Textract sync-compatible image bytes at this stage, and mark PDFs/manual multi-page documents as `manual_required` until the S3 path is specified.
