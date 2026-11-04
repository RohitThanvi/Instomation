import { DELETION_DEADLINE_DAYS, ROUTES } from '@/config/constants'
import type { LegalIdentity } from '@/config/env'
import { Link } from 'react-router-dom'
import { ContactLink, LegalLayout, LegalSection } from './legal-layout'

export function PrivacyPage({ legal }: { legal: LegalIdentity }) {
  return (
    <LegalLayout title="Privacy policy" legal={legal}>
      <p className="text-ink-muted leading-relaxed">
        Instomation helps businesses answer the direct messages and comments they receive on
        Instagram. This policy explains what personal data {legal.entityName} (&ldquo;we&rdquo;)
        handles to provide that service, why, who else sees it, and the choices you have. It covers
        the businesses that use Instomation and the people who message those businesses.
      </p>

      <LegalSection title="Who this applies to">
        <ul>
          <li>
            <strong>Business users</strong> create a workspace and connect their Instagram
            professional account.
          </li>
          <li>
            <strong>Customers</strong> are people who send a message or leave a comment on a
            connected Instagram account. The business decides to use Instomation to respond to you;
            we process your message on the business&rsquo;s behalf.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Account details:</strong> your name, email address and workspace membership,
            provided through our sign-in provider.
          </li>
          <li>
            <strong>Instagram connection:</strong> the connected account&rsquo;s ID and username,
            the permissions you granted, and an access token. The token is encrypted before it is
            stored.
          </li>
          <li>
            <strong>Conversations:</strong> messages and comments sent to a connected account, the
            sender&rsquo;s Instagram-scoped ID, username and display name where Instagram provides
            them, timestamps, and the replies sent back.
          </li>
          <li>
            <strong>Business content:</strong> the business profile, assistant settings, knowledge
            base entries and automation rules that the business enters.
          </li>
          <li>
            <strong>Operational data:</strong> AI usage records, audit logs, background job records,
            the webhook events Instagram delivers, and technical data such as IP address used for
            rate limiting and security.
          </li>
        </ul>
        <p>
          We do not ask for your Instagram password. The connection is made through
          Instagram&rsquo;s official authorization flow.
        </p>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>to receive messages and comments and show them to the business in its inbox;</li>
          <li>
            to prepare and send replies, either from a business&rsquo;s automation rules or with
            help from an AI model, and to pass a conversation to a person when it needs one;
          </li>
          <li>to check messages for unsafe content before any automated reply is sent;</li>
          <li>to run, secure and troubleshoot the service and measure usage;</li>
          <li>to meet legal obligations.</li>
        </ul>
        <p>
          Data we receive from Instagram is used only to provide these features to the business that
          connected the account. We do not sell personal data, and we do not use it to train models
          of our own.
        </p>
      </LegalSection>

      <LegalSection title="Who we share it with">
        <p>We use these service providers to run Instomation:</p>
        <ul>
          <li>
            <strong>Meta / Instagram</strong>, the source of messages and comments and the channel
            replies are sent through.
          </li>
          <li>
            <strong>Our sign-in provider</strong>, which handles authentication.
          </li>
          <li>
            <strong>AI providers</strong> (currently Groq, with OpenAI as a fallback). The text of a
            message and the business content needed to answer it are sent to generate or check a
            reply. Each provider handles that text under its own terms.
          </li>
          <li>
            <strong>Our hosting and infrastructure providers</strong>, which store and process the
            data described above on our behalf.
          </li>
        </ul>
        <p>
          We may also disclose data when the law requires it or to protect the rights, safety and
          security of our users and the service.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          Disconnecting an Instagram account removes our access token immediately. Conversation
          history is kept, so it is still there if the account is reconnected, until the business
          asks us to delete it. Deletion requests are handled as described on the{' '}
          <Link to={ROUTES.dataDeletion} className="text-accent-600 underline">
            data deletion page
          </Link>
          , within {DELETION_DEADLINE_DAYS} days of verification. Some records may be kept longer
          where the law requires it, and backup copies, if any, expire on their normal rotation.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Connections to Instomation use HTTPS, access tokens are encrypted at rest, every
          workspace&rsquo;s data is kept separate from every other&rsquo;s, and incoming Instagram
          events are verified by signature before they are processed. No online service can promise
          perfect security, but we treat protecting this data as a core requirement.
        </p>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <p>
          Depending on where you live, you may have the right to access, correct, delete or object
          to the use of your personal data. Businesses can edit or remove their content in the app
          and can disconnect Instagram at any time. If you messaged a business that uses
          Instomation, you can ask us or the business to delete your messages. Write to{' '}
          <ContactLink legal={legal} /> and we will respond within a reasonable time.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          Instomation is built for businesses and is not directed at anyone under 18. If you believe
          a child&rsquo;s data has been sent to us, contact us and we will delete it.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If we change this policy in substance, we will update the effective date above and, for
          significant changes, notify workspace owners. Questions or requests:{' '}
          <ContactLink legal={legal} />.
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
