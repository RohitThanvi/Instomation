import { Link } from 'react-router-dom'
import { DELETION_DEADLINE_DAYS, ROUTES } from '@/config/constants'
import type { LegalIdentity } from '@/config/env'
import { ContactLink, LegalLayout, LegalSection } from './legal-layout'

export function DataDeletionPage({ legal }: { legal: LegalIdentity }) {
  return (
    <LegalLayout title="Data deletion" legal={legal}>
      <p className="text-ink-muted leading-relaxed">
        You can stop Instomation&rsquo;s access to your Instagram account yourself, and you can ask
        us to delete the data we hold. This page explains both.
      </p>

      <LegalSection title="1. Stop access (immediate)">
        <p>
          Sign in, open{' '}
          <Link to={ROUTES.instagramSettings} className="text-accent-600 underline">
            Settings &rarr; Instagram
          </Link>{' '}
          and disconnect the account. Our access token is removed straight away and Instomation
          stops receiving and answering that account&rsquo;s messages. You can also remove
          Instomation from the connected apps or tools in your Instagram account settings.
        </p>
        <p>
          Disconnecting keeps your conversation history so it is still there if you reconnect. It
          does not delete it.
        </p>
      </LegalSection>

      <LegalSection title="2. Request deletion of your data">
        <p>
          Email <ContactLink legal={legal} /> with the subject &ldquo;Data deletion request&rdquo;.
          Include:
        </p>
        <ul>
          <li>the email address you signed up with, or the Instagram username concerned;</li>
          <li>
            whether you want your whole workspace deleted, or only specific conversations or
            messages.
          </li>
        </ul>
        <p>
          We confirm who is asking before deleting, because a deletion cannot be undone. We then
          complete the deletion within {DELETION_DEADLINE_DAYS} days and confirm by email.
        </p>
      </LegalSection>

      <LegalSection title="What is deleted">
        <ul>
          <li>the Instagram connection and any stored token;</li>
          <li>customers, conversations, messages and comments;</li>
          <li>your business profile, assistant settings, knowledge base and automation rules;</li>
          <li>your account and workspace membership.</li>
        </ul>
        <p>
          Some records, such as audit logs or items we must keep for legal reasons, may be kept for
          the period the law requires. Backup copies, if any, expire on their normal rotation.
        </p>
      </LegalSection>

      <LegalSection title="If you messaged a business that uses Instomation">
        <p>
          You do not need an account. Email <ContactLink legal={legal} /> with your Instagram
          username and the business you contacted, and we will delete your messages and comments
          from that business&rsquo;s workspace. You can also ask the business directly.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
