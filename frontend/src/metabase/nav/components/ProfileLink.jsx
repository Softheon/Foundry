import React, { Component } from "react";
import PropTypes from "prop-types";
import { Box } from "grid-styled";

import { t } from "c-3po";
import _ from "underscore";
import { capitalize } from "metabase/lib/formatting";

import MetabaseSettings from "metabase/lib/settings";
import * as Urls from "metabase/lib/urls";
import Modal from "metabase/components/Modal";
import Logs from "metabase/components/Logs";

import LogoIcon from "metabase/components/LogoIcon";
import EntityMenu from "metabase/components/EntityMenu";

// generate the proper set of list items for the current user
// based on whether they're an admin or not
export default class ProfileLink extends Component {
  state = {
    dropdownOpen: false,
  };

  static propTypes = {
    user: PropTypes.object.isRequired,
    context: PropTypes.string.isRequired,
  };

  openModal = modalName => {
    this.setState({ dropdownOpen: false, modalOpen: modalName });
  };

  closeModal = () => {
    this.setState({ modalOpen: null });
  };

  generateOptionsForUser = () => {
    const { tag } = MetabaseSettings.get("version");
    const admin = this.props.user.is_superuser;
    const manager = this.props.user.is_manager || false;
    const adminContext = this.props.context === "admin";
    const managerContext = this.props.context === "manager";
    return [
      {
        title: t`Account settings`,
        icon: null,
        link: Urls.accountSettings(),
        event: `Navbar;Profile Dropdown;Edit Profile`,
      },
      ...(admin && [
        {
          title: adminContext ? t`Exit admin` : t`Admin`,
          icon: null,
          link: adminContext ? "/" : "/admin",
          event: `Navbar;Profile Dropdown;${
            adminContext ? "Exit Admin" : "Enter Admin"
            }`,
        },
      ]),
      ...(admin && [
        {
          title: t`Logs`,
          icon: null,
          action: () => this.openModal("logs"),
          event: `Navbar;Profile Dropdown;Debugging ${tag}`,
        },
      ]),
      ...(manager
        && !admin
        && [
          {
            title: managerContext ? t`Exit Manager` : t`Manager`,
            icon: null,
            link: managerContext ? "/" : "/manager",
            event: `Navbar: Profile Dropdown;${
              managerContext ? "Exit Manager" : "Enter Manager"
              }`,
          },
        ]),
      {
        title: t`Sign out`,
        icon: null,
        link: "auth/logout",
        event: `Navbar;Profile Dropdown;Logout`,
      },
    ];
  };

  render() {
    const { modalOpen } = this.state;
    const { tag, date, ...versionExtra } = MetabaseSettings.get("version");
    return (
      <Box>
        <EntityMenu
          tooltip={t`Settings`}
          items={this.generateOptionsForUser()}
          triggerIcon="gear"
        />
        {modalOpen === "about" ? (
          <Modal small onClose={this.closeModal}>
            <div className="px4 pt4 pb2 text-centered relative">
              <div className="text-brand pb2">
                <LogoIcon width={48} height={48} />
              </div>
              <h2 style={{ fontSize: "1.75em" }} className="text-dark">
                {t`Thanks for using`} Foundry!
              </h2>
              <div className="pt2">
                <h3 className="text-dark mb1">
                  {t`You're on version`} {tag}
                </h3>
                <p className="text-medium text-bold">
                  {t`Built on`} {date}
                </p>
                {!/^v\d+\.\d+\.\d+$/.test(tag) && (
                  <div>
                    {_.map(versionExtra, (value, key) => (
                      <p key={key} className="text-medium text-bold">
                        {capitalize(key)}: {value}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div
              style={{ borderWidth: "2px" }}
              className="p2 h5 text-centered text-medium border-top"
            >

            </div>
          </Modal>
        ) : modalOpen === "logs" ? (
          <Modal wide onClose={this.closeModal}>
            <Logs onClose={this.closeModal} />
          </Modal>
        ) : null}
      </Box>
    );
  }
}
