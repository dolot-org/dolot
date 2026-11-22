import { Link } from 'react-router';
import { LEGAL_VERSION } from '../../shared/legal';
import { PageTitle, Panel } from '../components/ui';
import { useLocale } from '../lib/preferences';
import { source } from '../lib/source';

export function Agreement() {
  const { tr } = useLocale();
  return <article className="narrow stack legal-document">
    <PageTitle title={tr('用户协议', 'User Agreement')} subtitle={tr('生效日期', 'Effective date') + ' ' + LEGAL_VERSION} />
    <Panel title={tr('协议范围与同意', 'Scope and acceptance')}>
      <p>{tr(
        '本协议适用于你在此 Dotlo 站点创建账户及使用域名管理功能。注册前请阅读本协议和服务条款。勾选同意并完成注册后，两个文件共同适用于你的账户和对服务的使用。',
        'This Agreement applies when you create an account or manage domains on this Dotlo service. Read this Agreement and the Terms of Service before signing up. When you accept both documents and complete registration, they apply together to your account and use of the service.',
      )}</p>
      <p>{tr(
        '你须具备适用法律要求的缔约资格。代表组织使用时，你须有权代表该组织接受协议和管理所申请的域名。',
        'You must have the capacity to enter into this agreement under applicable law. If you use Dotlo for an organization, you must be authorized to accept these documents and manage the requested domains on its behalf.',
      )}</p>
      <Link className="text-link fit" to="/terms">{tr('阅读服务条款', 'Read the Terms of Service')}</Link>
    </Panel>
    <Panel title={tr('账户与安全', 'Account and security')}>
      <p>{tr(
        '账户使用 Passkey 登录。请保护保存 Passkey 的设备、同步账户和登录会话，并及时撤销不再信任的会话或凭据。保留可用的 Passkey，以便在更换或丢失设备后访问账户。',
        'Accounts use passkeys. Protect the devices, sync accounts, and sessions you use to sign in. Revoke sessions and credentials you no longer trust, and keep a usable passkey so you can access your account after losing or replacing a device.',
      )}</p>
      <p>{tr(
        '请提供合法、准确的账户资料，并采取合理措施防止未经授权的使用。发现账户或域名可能被他人控制时，请尽快通过本站的联系渠道告知。',
        'Provide lawful and accurate account information and take reasonable steps to prevent unauthorized use. Use the site contact channels promptly if you suspect someone else has gained control of your account or domain.',
      )}</p>
    </Panel>
    <Panel title={tr('我们处理的信息', 'Information we process')}>
      <p>{tr(
        '为提供服务，Dotlo 保存用户名、你填写的显示名称和联系方式、Passkey 公钥及设备信息、会话、域名和 DNS 记录，以及你同意的协议版本和时间。Passkey 私钥由你的设备或 Passkey 提供商保管。',
        'To provide the service, Dotlo stores your username, any display name and contact details you provide, passkey public keys and device metadata, sessions, domains and DNS records, and the version and time of your acceptance. Your device or passkey provider holds the private key.',
      )}</p>
      <p>{tr(
        'Dotlo 使用登录 IP、浏览器信息、操作记录和访问频率来维持会话、防止滥用和排查问题。举报可能包含域名、情况说明、你提供的联系方式及用于处理举报的技术信息。浏览器会保存会话 Cookie、语言和主题偏好，以及 PWA 所需的本地缓存。',
        'Dotlo uses sign-in IP addresses, browser information, activity logs, and request rates to maintain sessions, prevent abuse, and troubleshoot. Abuse reports may include a domain name, details, your contact information, and technical information used to handle the report. Your browser stores the session cookie, language and theme preferences, and the app cache.',
      )}</p>
      <p>{tr(
        'Cloudflare 提供网站运行和 DNS 服务。启用 Turnstile 时，注册或举报也会通过 Cloudflare 进行人机验证。已发布的 DNS 记录和其中的值可被 Internet 上的任何人查询，请勿在记录中填写密码、密钥或其他敏感信息。',
        'Cloudflare provides hosting and DNS. When Turnstile is enabled, Cloudflare also handles human verification for registration or abuse reports. Anyone on the internet can query published DNS records and their values. Keep passwords, keys, and other sensitive information out of DNS records.',
      )}</p>
    </Panel>
    <Panel title={tr('保存期限与账户注销', 'Retention and account closure')}>
      <p>{tr(
        '账户与域名资料在提供服务所需期间保存。定时任务清理过期验证请求和会话，应用审计记录通常保留约一年。处理举报、保障安全或履行法律义务所需的记录可能在账户注销后继续保留。',
        'Account and domain data are kept for as long as needed to provide the service. Scheduled maintenance clears expired authentication challenges and sessions. App audit records are normally kept for about a year. Records needed for abuse investigations, security, or legal obligations may be retained after account closure.',
      )}</p>
      <p>{tr(
        '你可以在账户设置中更新资料、管理 Passkey 和会话，并在转移或释放全部域名后删除账户。删除账户会移除账户资料、Passkey、会话和同意记录。你也可以通过本站发布的联系渠道提出适用法律规定的数据请求。',
        'In account settings, you can update your profile, manage passkeys and sessions, and delete your account after transferring or releasing all domains. Account deletion removes your profile, passkeys, sessions, and acceptance records. Use the published contact channel for data requests available under applicable law.',
      )}</p>
    </Panel>
    <Panel title={tr('版本与联系', 'Updates and contact')}>
      <p>{tr(
        '本站会在页面上公布当前协议版本。重大变更将按适用法律要求通知，必要时另行征得同意。如果你不接受变更，可以停止使用并按服务条款处理已分配的域名。',
        'The current version is published on this page. We will give notice of significant changes and ask for renewed acceptance when required by applicable law. If you decline a change, you can stop using Dotlo and handle your allocated domains under the Terms of Service.',
      )}</p>
      <Link className="text-link fit" to="/about">{tr('项目与联系渠道', 'Project and contact channels')}</Link>
    </Panel>
  </article>;
}

export function Terms() {
  const { tr } = useLocale();
  return <article className="narrow stack legal-document">
    <PageTitle title={tr('服务条款', 'Terms of Service')} subtitle={tr('生效日期', 'Effective date') + ' ' + LEGAL_VERSION} />
    <Panel title={tr('服务与域名使用权', 'Service and domain rights')}>
      <p>{tr(
        'Dotlo 提供免费的二级域名或子域名注册及 DNS 管理。成功认领后，你可在该后缀的规则和登记期限内管理获分配的名称。分配仅赋予在本站规则内管理该子域名的权限，父域名的所有权和注册人资格由原权利人保留。',
        'Dotlo provides free subdomain registration and DNS management. A successful claim lets you manage the allocated name subject to the rules and registration period of its suffix. The parent domain remains with its registrant. Your allocation gives you the ability to manage that subdomain under these terms.',
      )}</p>
      <p>{tr(
        '域名能否分配取决于名称可用性、保留名称、后缀规则、审核，以及账户和全站配额。管理页面显示各后缀支持的记录类型、记录数量和代理选项。查询结果仅反映当时状态，以注册成功为准。',
        'Allocation depends on name availability, reserved names, suffix rules, review requirements, and account and site capacity. The management page shows the record types, record limits, and proxy options available for a suffix. A lookup shows availability at that time. The name is allocated when the claim succeeds.',
      )}</p>
    </Panel>
    <Panel title={tr('续期 转移与释放', 'Renewals transfers and release')}>
      <p>{tr(
        '请以域名详情中的到期时间、续期窗口和宽限期为准。到期后解析可能暂停，宽限期结束后域名及其记录可能被回收。及时续期并自行保存所需的 DNS 配置。',
        'Check the expiry date, renewal window, and grace period in your domain details. DNS may stop after expiry, and the domain and its records may be reclaimed after the grace period. Renew in time and keep a copy of any DNS configuration you need.',
      )}</p>
      <p>{tr(
        '转移码可用于将域名和关联的 DNS 记录交给另一账户。请仅将转移码提供给预定接收方。主动释放会撤下解析并使该名称可重新分配。DNS 缓存可能延迟显示更新。',
        'A transfer code lets another account take control of a domain and its DNS records. Share it only with the intended recipient. Releasing a name removes its DNS records and makes the name eligible for reassignment. DNS caches may delay visible changes.',
      )}</p>
    </Panel>
    <Panel title={tr('可接受使用', 'Acceptable use')}>
      <p>{tr(
        '你须遵守适用法律、尊重他人权利，并确保 DNS 记录及经由域名提供的内容具有必要授权。禁止使用域名实施钓鱼、诈骗、恶意软件分发、垃圾信息、未经授权的访问、干扰网络服务或其他违法行为。',
        'Follow applicable law, respect third-party rights, and obtain the permissions needed for the DNS records and content you make available through your domain. Prohibited uses include phishing, fraud, malware distribution, spam, unauthorized access, disruption of network services, and other unlawful activity.',
      )}</p>
      <p>{tr(
        '禁止冒用他人身份、侵害知识产权、通过多账户或自动化手段规避配额与频率限制，以及妨碍站点安全或稳定运行。',
        'Do not impersonate others, infringe intellectual property rights, use multiple accounts or automation to evade quotas or rate limits, or interfere with the security or operation of the site.',
      )}</p>
    </Panel>
    <Panel title={tr('举报与处理', 'Reports and enforcement')}>
      <p>{tr(
        '发现滥用时，可提交域名、说明和相关证据。Dotlo 可调查举报，并在保护用户、第三方或服务安全，执行规则或遵守法律所需时暂停解析、限制账户或回收域名。',
        'Report suspected abuse with the domain name, an explanation, and relevant evidence. Dotlo may investigate reports and suspend DNS, restrict accounts, or reclaim domains where needed to protect users, third parties, or the service, enforce these terms, or comply with legal obligations.',
      )}</p>
      <p>{tr(
        '对于影响账户或域名的措施，在适当且可行时会说明原因。你可通过本站公布的联系渠道提供补充信息或请求复核。',
        'Where appropriate and practicable, Dotlo will explain action affecting your account or domain. Use the published contact channel to provide further information or request a review.',
      )}</p>
      <Link className="text-link fit" to="/report">{tr('举报滥用', 'Report abuse')}</Link>
    </Panel>
    <Panel title={tr('服务可用性与责任', 'Availability and liability')}>
      <p>{tr(
        '服务按现有条件提供。维护、故障、上游服务变更或安全事件可能导致中断。请为依赖域名的业务保留可用的备份方案。',
        'The service is provided as available. Maintenance, outages, upstream changes, and security incidents may interrupt access. Keep a fallback for services that depend on your domain.',
      )}</p>
      <p>{tr(
        '在适用法律允许的范围内，Dotlo 不对间接损失或因第三方服务中断造成的损失承担责任。适用法律赋予你的强制性消费者权利及依法不得排除的责任继续有效。',
        'To the extent permitted by applicable law, Dotlo is not liable for indirect loss or loss caused by third-party service outages. Mandatory consumer rights and any liability that cannot lawfully be excluded continue to apply.',
      )}</p>
    </Panel>
    <Panel title={tr('数据权利与开源许可', 'Data rights and software license')}>
      <p>{tr(
        '你保留对自己提供的内容依法享有的权利。通过提交解析记录，你允许 Dotlo 和其 DNS 服务提供商按提供服务所需存储、传输和发布这些记录。账户资料和举报信息的处理见用户协议。',
        'You retain the rights you hold in the content you provide. By submitting DNS records, you authorize Dotlo and its DNS provider to store, transmit, and publish those records as needed to provide the service. The User Agreement describes how account and report information is handled.',
      )}</p>
      <p>{tr(
        '本条款约定托管服务的使用规则。Dotlo 程序的复制、修改和分发权限由 AGPLv3 许可证规定。',
        'These terms govern use of the hosted service. The AGPLv3 license governs the right to copy, modify, and distribute the Dotlo software.',
      )}</p>
      <div className="actions">
        <Link className="text-link" to="/agreement">{tr('用户协议', 'User Agreement')}</Link>
        <Link className="text-link" to="/about">{tr('关于与源码', 'About and source code')}</Link>
      </div>
    </Panel>
  </article>;
}

export function About({ contact }: { contact?: string }) {
  const { tr } = useLocale();
  return <article className="narrow stack legal-document">
    <PageTitle title={tr('关于 Dotlo', 'About Dotlo')} subtitle={tr('免费的子域名注册和 DNS 管理', 'Free subdomain registration and DNS management')} />
    <Panel title={tr('开源许可证与对应源码', 'Open-source license and corresponding source')}>
      <p>{tr(
        'Dotlo 程序采用 GNU Affero General Public License 第 3 版（AGPL-3.0-only）。任何使用本站的人都可以免费下载对应源码，其中包括构建与运行所需的项目文件。',
        'Dotlo is licensed under the GNU Affero General Public License version 3 (AGPL-3.0-only). Anyone using this site can download the corresponding source at no charge, including the project files used to build and run it.',
      )}</p>
      <div className="actions">
        <a className="button primary" href={source.archive}>{tr('下载对应源码', 'Download corresponding source')}</a>
        <a className="button secondary" href={source.tree}>{tr('浏览源码', 'Browse source')}</a>
        <a className="button secondary" href={source.license}>{tr('查看许可证', 'View license')}</a>
      </div>
      {source.commit && <p className="muted break">{tr('部署提交', 'Deployed commit')} <code>{source.commit}</code></p>}
    </Panel>
    <Panel title={tr('项目与联系', 'Project and contact')}>
      <div className="actions">
        <a className="text-link" href={source.repository}>{tr('项目仓库', 'Project repository')}</a>
        <Link className="text-link" to="/report">{tr('举报滥用', 'Report abuse')}</Link>
        {contact && <a className="text-link break" href={'mailto:' + contact}>{contact}</a>}
      </div>
      <div className="actions">
        <Link className="text-link" to="/agreement">{tr('用户协议', 'User Agreement')}</Link>
        <Link className="text-link" to="/terms">{tr('服务条款', 'Terms of Service')}</Link>
      </div>
    </Panel>
  </article>;
}
