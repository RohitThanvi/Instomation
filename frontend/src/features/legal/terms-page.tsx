import { Link } from 'react-router-dom'
import { ROUTES } from '@/config/constants'
import type { LegalIdentity } from '@/config/env'
import { ContactLink, LegalLayout, LegalSection } from './legal-layout'

export function TermsPage({ legal }: { legal: LegalIdentity }) {
  return (
    <LegalLayout title="Terms of service" legal={legal}>
      <p className="text-ink-muted leading-relaxed">
        These terms govern your use of Instomation, operated by {legal.entityName}
        (&ldquo;we&rdquo;). By creating a workspace or connecting an Instagram account you agree to
        them. If you use Instomation for a business, you confirm you are allowed to bind that
        business.
      </p>

      <LegalSection title="The service">
        <p>
          Instomation lets a business receive its Instagram direct messages and comments in one
          inbox, set automation rules, and have an AI assistant draft or send replies from the
          business&rsquo;s own information, handing conversations to a person when needed. Features
          and limits may change as the service develops, and usage limits can apply.
        </p>
      </LegalSection>

      <LegalSection title="Your account and workspace">
        <ul>
          <li>Provide accurate details and keep your sign-in credentials secure.</li>
          <li>
            You are responsible for what members of your workspace do and for the roles you give
            them.
          </li>
          <li>Tell us promptly if you suspect unauthorized access.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Instagram and Meta rules">
        <p>
          You may connect only an Instagram account you own or are authorized to manage. You must
          follow Meta&rsquo;s Platform Terms and Instagram&rsquo;s policies, including the rules on
          messaging windows, private replies to comments, and automated messaging. Instagram may
          limit, change or end what its API allows at any time; we are not responsible for that.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>You agree not to use Instomation to:</p>
        <ul>
          <li>send spam, unsolicited bulk messages, or deceptive or misleading content;</li>
          <li>harass, threaten or discriminate against anyone;</li>
          <li>break the law, or infringe anyone&rsquo;s privacy or intellectual property;</li>
          <li>
            collect personal data from conversations for purposes other than serving your own
            customers;
          </li>
          <li>probe, overload or bypass the security or limits of the service.</li>
        </ul>
        <p>We may suspend a workspace that breaks these rules.</p>
      </LegalSection>

      <LegalSection title="AI-generated replies">
        <p>
          Replies written by an AI model can be wrong or incomplete. You are responsible for the
          information you give the assistant, for the settings and rules you choose, for reviewing
          conversations that matter, and for telling your customers they are talking to an automated
          assistant where the law or Instagram&rsquo;s rules require it.
        </p>
      </LegalSection>

      <LegalSection title="Your content and our service">
        <p>
          You keep ownership of your business content and your customers&rsquo; messages. You give
          us permission to process them only to provide the service, as described in the{' '}
          <Link to={ROUTES.privacy} className="text-accent-600 underline">
            privacy policy
          </Link>
          . We own the Instomation software and brand.
        </p>
      </LegalSection>

      <LegalSection title="Ending your use">
        <p>
          You can disconnect Instagram or stop using Instomation at any time, and ask for your data
          to be deleted as described on the{' '}
          <Link to={ROUTES.dataDeletion} className="text-accent-600 underline">
            data deletion page
          </Link>
          . We may suspend or end access for breaches of these terms or to protect the service.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers and liability">
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without
          promises that it will be uninterrupted or error-free. To the extent the law allows, we are
          not liable for indirect or consequential losses, lost profits, or losses caused by
          Instagram or other third parties, and our total liability for any claim is limited to the
          amount you paid us for the service in the twelve months before the claim, or zero if you
          paid nothing.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          We may update these terms; the effective date above shows the current version, and
          continued use after a change means you accept it. Questions: <ContactLink legal={legal} />
          .
        </p>
      </LegalSection>
    </LegalLayout>
  )
}
