import React, { Component } from "react";
import ReactRetinaImage from "react-retina-image";
import { t } from "c-3po";
import SettingsInput from "./SettingInput";
import cx from "classnames";

const PREMIUM_EMBEDDING_STORE_URL =
  "";
const PREMIUM_EMBEDDING_SETTING_KEY = "";

class PremiumTokenInput extends Component {
  state = {
    errorMessage: "",
  };
  render() {
    const { token, onChangeSetting } = this.props;
    const { errorMessage } = this.state;

    let message;

    if (errorMessage) {
      message = errorMessage;
    } else if (token) {
      message = t`Premium embedding enabled`;
    } else {
      message = t`Enter the token you bought from the Foundry Store`;
    }

    return (
      <div className="mb3">
        {/* <h3 className={cx("mb1", { "text-danger": errorMessage })}>
          {message}
        </h3>
        <SettingsInput
          onChange={async value => {
            try {
              await onChangeSetting(PREMIUM_EMBEDDING_SETTING_KEY, value);
            } catch (error) {
              this.setState({ errorMessage: error.data });
            }
          }}
          setting={{ value: token }}
          autoFocus={!token}
        /> */}
      </div>
    );
  }
}

const PremiumExplanation = ({ showEnterScreen }) => (
  <div>
    {/* <h2>Premium embedding</h2>
    <p className="mt1">{t`Premium embedding lets you disable "Powered by Foundry" on your embedded dashboards and queries.`}</p>
    <div className="mt2 mb3">
      <a
        className="link mx1"
        href={PREMIUM_EMBEDDING_STORE_URL}
        target="_blank"
      >
        {t`Buy a token`}
      </a>
      <a className="link mx1" onClick={showEnterScreen}>
        {t`Enter a token`}
      </a>
    </div> */}
  </div>
);

class PremiumEmbedding extends Component {
  constructor(props) {
    super(props);
    this.state = {
      showEnterScreen: props.token,
    };
  }
  render() {
    const { token, onChangeSetting } = this.props;
    const { showEnterScreen } = this.state;

    return (
      <div className="text-centered text-paragraph">
        {/* {showEnterScreen ? (
          <PremiumTokenInput onChangeSetting={onChangeSetting} token={token} />
        ) : (
          <PremiumExplanation
            showEnterScreen={() => this.setState({ showEnterScreen: true })}
          />
        )} */}
      </div>
    );
  }
}

class EmbeddingLevel extends Component {
  render() {
    const { onChangeSetting, settingValues } = this.props;

    const premiumToken = settingValues[PREMIUM_EMBEDDING_SETTING_KEY];

    return (
      <div
        className="bordered rounded full text-centered"
        style={{ maxWidth: 820 }}
      >
        <ReactRetinaImage
          src={`app/assets/img/${
            premiumToken ? "premium_embed_added" : "premium_embed"
          }.png`}
        />
        <div className="flex align-center justify-center">
          <PremiumEmbedding
            token={premiumToken}
            onChangeSetting={onChangeSetting}
          />
        </div>
      </div>
    );
  }
}

export default EmbeddingLevel;
