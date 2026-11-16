<?php

declare(strict_types=1);

namespace Drupal\naturedex_core\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\naturedex_core\SiteCopy;

/**
 * Edits the site-wide wording: the sidebar tagline, footer line, and default
 * search description. A page's own heading is edited on the page.
 */
final class SiteCopyForm extends ConfigFormBase {

  public function getFormId(): string {
    return 'naturedex_site_copy';
  }

  protected function getEditableConfigNames(): array {
    return [SiteCopy::CONFIG];
  }

  public function buildForm(array $form, FormStateInterface $form_state): array {
    $form['tagline'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Sidebar tagline'),
      '#description' => $this->t('Shown under the navigation. Each line break starts a new line on the site.'),
      '#rows' => 2,
      '#required' => TRUE,
      '#config_target' => SiteCopy::CONFIG . ':tagline',
    ];
    $form['footer_motto'] = [
      '#type' => 'textfield',
      '#title' => $this->t('Footer line'),
      '#description' => $this->t('Shown at the bottom of every page.'),
      '#maxlength' => 255,
      '#required' => TRUE,
      '#config_target' => SiteCopy::CONFIG . ':footer_motto',
    ];
    $form['meta_description'] = [
      '#type' => 'textarea',
      '#title' => $this->t('Default search description'),
      '#description' => $this->t('Used by search engines and link previews when a page has no description of its own. Keep it under about 160 characters.'),
      '#rows' => 3,
      '#required' => TRUE,
      '#config_target' => SiteCopy::CONFIG . ':meta_description',
    ];
    return parent::buildForm($form, $form_state);
  }

}
