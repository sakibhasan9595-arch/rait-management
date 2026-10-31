# Rait Management — Firebase-connected PWA starter

## Important
This is a first Firebase-connected starter, not a finished production app. Test with non-critical sample data first. It currently supports email/password login, registration requests, owner approval, basic sales entries, products, restocks and daily summary reports.

## Publish
Upload the contents of this folder to the root of the GitHub repository. Do not upload the ZIP as a single file.

## Firestore Security Rules
Before testing registration, replace the existing Firestore Rules with the contents of `firestore.rules` and Publish. The rule change adds a restricted `registrationRequests/{uid}` path. It does not allow pending users to read business data.

## Owner
The existing Owner profile document in `users/{OWNER_UID}` must remain active with role `owner` and the permissions map previously configured.

## Limitations in this starter
- Sales entry editing, custom per-user permission editor, product variant inventory deduction, full offline write queue and robust conflict handling are not implemented yet.
- Firestore offline persistence caches data, but this starter does not guarantee every write can be queued and safely reconciled.
- The PWA shell can be installed from Chrome after HTTPS hosting is configured.
- Do not put service-account private keys in this repository.
